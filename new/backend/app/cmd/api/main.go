package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/tyler71/owlchirp/app/internal/auth"
	"github.com/tyler71/owlchirp/app/internal/connect"
	"github.com/tyler71/owlchirp/app/internal/database"
	"github.com/tyler71/owlchirp/app/internal/env"
	"github.com/tyler71/owlchirp/app/internal/flags"
	"github.com/tyler71/owlchirp/app/internal/realtime"
	"github.com/tyler71/owlchirp/app/internal/version"

	"github.com/lmittmann/tint"
)

func main() {
	logger := slog.New(tint.NewHandler(os.Stdout, &tint.Options{Level: logLevel(env.GetString("LOG_LEVEL", "info"))}))

	err := run(logger)
	if err != nil {
		trace := string(debug.Stack())
		logger.Error(err.Error(), "trace", trace)
		os.Exit(1)
	}
}

func logLevel(s string) slog.Level {
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToUpper(s))); err != nil {
		return slog.LevelInfo
	}
	return level
}

type config struct {
	host     string
	httpPort int
	devMode  bool

	db struct {
		dsn string
	}
	connect struct {
		instance    string
		domain      string
		cacheLength time.Duration
	}
	frontend struct {
		timeZone     string
		telemetryURL string
	}
	flags struct {
		endpoint string
		apiKey   string
	}
}

type flagEvaluator interface {
	Owlchirp(ctx context.Context, username string) bool
}

type application struct {
	config   config
	db       *database.DB
	connect  *connect.Client
	auth     *auth.Verifier
	hub      *realtime.Hub
	flags    flagEvaluator
	handlers map[string]wsHandler
	logger   *slog.Logger
	wg       sync.WaitGroup
}

func run(logger *slog.Logger) error {
	var cfg config

	cfg.host = env.GetString("HOST", "0.0.0.0")
	cfg.httpPort = env.GetInt("APP_PORT", 4444)
	cfg.devMode = env.GetBool("DEV_MODE", false)

	// DB_STRING is the variable used by the Python version; DB_DSN takes precedence.
	cfg.db.dsn = env.GetString("DB_DSN", env.GetString("DB_STRING", "./_data/owlchirp.sqlite3"))

	cfg.connect.instance = env.GetString("CONNECT_INSTANCE", "")
	cfg.connect.domain = strings.TrimRight(env.GetString("CONNECT_DOMAIN", ""), "/")
	cfg.connect.cacheLength = time.Duration(env.GetInt("AWS_CONNECT_CACHE_LENGTH", 10)) * time.Second

	cfg.frontend.timeZone = env.GetString("TIME_ZONE", "UTC")
	cfg.frontend.telemetryURL = env.GetString("TELEMETRY_URL", "")

	cfg.flags.endpoint = env.GetString("GOFF_ENDPOINT", "https://flag.sandcatdev.com")
	cfg.flags.apiKey = env.GetString("GOFF_API_KEY", "")

	showVersion := flag.Bool("version", false, "display version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("version: " + version.Get())
		return nil
	}

	logger.Info("starting OwlChirp", "version", version.Get())

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := database.New(cfg.db.dsn)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer db.Close()

	cc, err := connect.New(ctx, cfg.connect.instance, cfg.connect.cacheLength)
	if err != nil {
		return fmt.Errorf("connect client: %w", err)
	}

	if cfg.flags.endpoint == "" {
		logger.Warn("GOFF_ENDPOINT is empty; feature flags disabled, owlchirp is off for everyone")
	}
	ff, err := flags.New(cfg.flags.endpoint, cfg.flags.apiKey, logger)
	if err != nil {
		return fmt.Errorf("feature flags: %w", err)
	}
	defer ff.Close()

	app := &application{
		config:  cfg,
		db:      db,
		connect: cc,
		auth:    auth.NewVerifier(cc),
		hub:     realtime.NewHub(cc.Snapshot, time.Second, logger),
		flags:   ff,
		logger:  logger,
	}

	app.handlers = app.wsHandlers()

	go app.hub.Run(ctx)

	return app.serveHTTP(ctx)
}
