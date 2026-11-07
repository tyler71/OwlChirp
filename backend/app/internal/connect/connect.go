// Package connect wraps the Amazon Connect API calls OwlChirp needs and caches
// them with the same lifetimes the original Python implementation used.
package connect

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	awsconnect "github.com/aws/aws-sdk-go-v2/service/connect"
	"github.com/aws/aws-sdk-go-v2/service/connect/types"

	"github.com/tyler71/owlchirp/app/internal/cache"
)

// handledIncomingStartHourUTC is the hour (UTC) the "handled today" counter
// starts from. 05:00 UTC keeps the window inside the 24h GetMetricData limit.
const handledIncomingStartHourUTC = 5

type RegisteredUser struct {
	ID       string
	Username string
}

type UserDetail struct {
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

type ActiveUser struct {
	UserID string `json:"user_id"`
	Status struct {
		Name string `json:"name"`
	} `json:"status"`
	User UserDetail `json:"user"`
}

type ContactDetail struct {
	ID                string    `json:"id"`
	InitiationMethod  string    `json:"initiation_method"`
	AgentName         string    `json:"agent_name"`
	EnqueueTimestamp  time.Time `json:"enqueue_timestamp"`
	AnsweredTimestamp time.Time `json:"answered_timestamp"`
	EndedTimestamp    time.Time `json:"ended_timestamp"`
	QueueTime         int       `json:"queue_time"`
	CallToQueueTime   int       `json:"call_to_queue_time"`
}

// FlowContact is an inbound voice contact found by SearchFlowContacts. Zero
// times mean the contact hasn't reached that stage.
type FlowContact struct {
	ID             string
	QueueName      string
	AgentName      string
	AgentUsername  string
	InitiatedAt    time.Time
	EnqueuedAt     time.Time
	ConnectedAt    time.Time
	DisconnectedAt time.Time
}

type currentMetrics struct {
	AgentsAvailable int
	AgentsStaffed   int
	ContactsInQueue int
}

type Client struct {
	api      *awsconnect.Client
	awsCfg   aws.Config
	instance string

	queues          *cache.Value[[]string]
	registeredUsers *cache.Value[[]RegisteredUser]
	metrics         *cache.Value[currentMetrics]
	handledIncoming *cache.Value[int]
	currentUsers    *cache.Value[[]types.UserData]
	contacts        *cache.Map[string, *types.Contact]
	users           *cache.Map[string, UserDetail]
	queueNames      *cache.Map[string, string]
	snapshot        *cache.Value[map[string]any]
}

// New creates a client using the default AWS credential chain
// (AWS_DEFAULT_REGION / AWS_REGION, env credentials, instance role, ...).
func New(ctx context.Context, instance string, snapshotTTL time.Duration) (*Client, error) {
	if instance == "" {
		return nil, errors.New("CONNECT_INSTANCE is required")
	}

	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, err
	}

	c := &Client{api: awsconnect.NewFromConfig(cfg), awsCfg: cfg, instance: instance}

	c.queues = cache.NewValue(6*time.Hour, c.fetchQueues)
	c.registeredUsers = cache.NewValue(10*time.Minute, c.fetchRegisteredUsers)
	c.metrics = cache.NewValue(4*time.Second, c.fetchMetrics)
	c.handledIncoming = cache.NewValue(30*time.Second, c.fetchHandledIncoming)
	c.currentUsers = cache.NewValue(4*time.Second, c.fetchCurrentUsers)
	c.contacts = cache.NewMap(time.Hour, 64, c.fetchContact)
	c.users = cache.NewMap(time.Hour, 256, c.fetchUser)
	c.queueNames = cache.NewMap(6*time.Hour, 256, c.fetchQueueName)
	c.snapshot = cache.NewValue(snapshotTTL, c.fetchSnapshot)

	return c, nil
}

func (c *Client) fetchQueues(ctx context.Context) ([]string, error) {
	var ids []string
	p := awsconnect.NewListQueuesPaginator(c.api, &awsconnect.ListQueuesInput{
		InstanceId: aws.String(c.instance),
		QueueTypes: []types.QueueType{types.QueueTypeStandard},
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list queues: %w", err)
		}
		for _, q := range page.QueueSummaryList {
			ids = append(ids, aws.ToString(q.Id))
		}
	}
	// The metric APIs accept at most 100 queues per filter.
	if len(ids) > 100 {
		ids = ids[:100]
	}
	return ids, nil
}

func (c *Client) fetchRegisteredUsers(ctx context.Context) ([]RegisteredUser, error) {
	var users []RegisteredUser
	p := awsconnect.NewListUsersPaginator(c.api, &awsconnect.ListUsersInput{
		InstanceId: aws.String(c.instance),
	})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list users: %w", err)
		}
		for _, u := range page.UserSummaryList {
			users = append(users, RegisteredUser{ID: aws.ToString(u.Id), Username: aws.ToString(u.Username)})
		}
	}
	return users, nil
}

func (c *Client) fetchMetrics(ctx context.Context) (currentMetrics, error) {
	var m currentMetrics

	queues, err := c.queues.Get(ctx)
	if err != nil {
		return m, err
	}

	out, err := c.api.GetCurrentMetricData(ctx, &awsconnect.GetCurrentMetricDataInput{
		InstanceId: aws.String(c.instance),
		Filters:    &types.Filters{Queues: queues},
		CurrentMetrics: []types.CurrentMetric{
			{Name: types.CurrentMetricNameAgentsAvailable, Unit: types.UnitCount},
			{Name: types.CurrentMetricNameAgentsStaffed, Unit: types.UnitCount},
			{Name: types.CurrentMetricNameContactsInQueue, Unit: types.UnitCount},
		},
	})
	if err != nil {
		return m, fmt.Errorf("get current metric data: %w", err)
	}

	for _, result := range out.MetricResults {
		for _, d := range result.Collections {
			if d.Metric == nil || d.Value == nil {
				continue
			}
			v := int(aws.ToFloat64(d.Value))
			switch d.Metric.Name {
			case types.CurrentMetricNameAgentsAvailable:
				m.AgentsAvailable += v
			case types.CurrentMetricNameAgentsStaffed:
				m.AgentsStaffed += v
			case types.CurrentMetricNameContactsInQueue:
				m.ContactsInQueue += v
			}
		}
	}
	return m, nil
}

// handledIncomingWindow returns the GetMetricData window for "calls handled
// today". Times must fall on 5 minute boundaries and span at most 24 hours.
func handledIncomingWindow(now time.Time) (start, end time.Time) {
	now = now.UTC()
	end = now.Truncate(5 * time.Minute)
	start = time.Date(end.Year(), end.Month(), end.Day(), handledIncomingStartHourUTC, end.Minute(), 0, 0, time.UTC)
	if !start.Before(end) {
		start = start.Add(-24 * time.Hour)
	}
	return start, end
}

func (c *Client) fetchHandledIncoming(ctx context.Context) (int, error) {
	queues, err := c.queues.Get(ctx)
	if err != nil {
		return 0, err
	}

	start, end := handledIncomingWindow(time.Now())
	out, err := c.api.GetMetricData(ctx, &awsconnect.GetMetricDataInput{
		InstanceId: aws.String(c.instance),
		StartTime:  aws.Time(start),
		EndTime:    aws.Time(end),
		Filters:    &types.Filters{Queues: queues},
		HistoricalMetrics: []types.HistoricalMetric{
			{Name: types.HistoricalMetricNameContactsHandledIncoming, Statistic: types.StatisticSum, Unit: types.UnitCount},
		},
	})
	if err != nil {
		return 0, fmt.Errorf("get metric data: %w", err)
	}

	total := 0
	for _, result := range out.MetricResults {
		for _, d := range result.Collections {
			if d.Metric != nil && d.Metric.Name == types.HistoricalMetricNameContactsHandledIncoming {
				total += int(math.Floor(aws.ToFloat64(d.Value)))
			}
		}
	}
	return total, nil
}

func (c *Client) fetchCurrentUsers(ctx context.Context) ([]types.UserData, error) {
	queues, err := c.queues.Get(ctx)
	if err != nil {
		return nil, err
	}

	var users []types.UserData
	input := &awsconnect.GetCurrentUserDataInput{
		InstanceId: aws.String(c.instance),
		Filters:    &types.UserDataFilters{Queues: queues},
	}
	for {
		out, err := c.api.GetCurrentUserData(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("get current user data: %w", err)
		}
		users = append(users, out.UserDataList...)
		if out.NextToken == nil {
			break
		}
		input.NextToken = out.NextToken
	}
	return users, nil
}

func (c *Client) fetchContact(ctx context.Context, contactID string) (*types.Contact, error) {
	out, err := c.api.DescribeContact(ctx, &awsconnect.DescribeContactInput{
		InstanceId: aws.String(c.instance),
		ContactId:  aws.String(contactID),
	})
	if err != nil {
		return nil, fmt.Errorf("describe contact: %w", err)
	}
	return out.Contact, nil
}

// AWSConfig is the AWS config the client was built with, so other AWS
// clients share its credentials and region.
func (c *Client) AWSConfig() aws.Config { return c.awsCfg }

// ErrNotAgentContact means the contact isn't connected to the given agent.
var ErrNotAgentContact = errors.New("contact is not handled by this agent")

// ErrNoMediaStream means the contact has no KVS stream ARN attribute.
var ErrNoMediaStream = errors.New("contact has no media stream")

// ContactStream returns the Kinesis Video Stream ARN the contact flow saved
// in the contact attribute named attr, after checking that the contact is
// connected to agentID. It bypasses the contact cache: the agent is only
// assigned once the call is answered.
func (c *Client) ContactStream(ctx context.Context, contactID, agentID, attr string) (string, error) {
	contact, err := c.fetchContact(ctx, contactID)
	if err != nil {
		return "", err
	}
	if contact.AgentInfo == nil || !strings.EqualFold(aws.ToString(contact.AgentInfo.Id), agentID) {
		return "", ErrNotAgentContact
	}

	// Attributes live on the first contact of a transfer chain.
	initial := contactID
	if id := aws.ToString(contact.InitialContactId); id != "" {
		initial = id
	}
	out, err := c.api.GetContactAttributes(ctx, &awsconnect.GetContactAttributesInput{
		InstanceId:       aws.String(c.instance),
		InitialContactId: aws.String(initial),
	})
	if err != nil {
		return "", fmt.Errorf("get contact attributes: %w", err)
	}
	arn := strings.TrimSpace(out.Attributes[attr])
	if !strings.HasPrefix(arn, "arn:") {
		return "", ErrNoMediaStream
	}
	return arn, nil
}

func (c *Client) fetchUser(ctx context.Context, userID string) (UserDetail, error) {
	out, err := c.api.DescribeUser(ctx, &awsconnect.DescribeUserInput{
		InstanceId: aws.String(c.instance),
		UserId:     aws.String(userID),
	})
	if err != nil {
		return UserDetail{}, fmt.Errorf("describe user: %w", err)
	}

	d := UserDetail{Username: aws.ToString(out.User.Username)}
	if out.User.IdentityInfo != nil {
		d.FirstName = aws.ToString(out.User.IdentityInfo.FirstName)
		d.LastName = aws.ToString(out.User.IdentityInfo.LastName)
	}
	return d, nil
}

func (c *Client) RegisteredUsers(ctx context.Context) ([]RegisteredUser, error) {
	return c.registeredUsers.Get(ctx)
}

// ActiveUsers returns the agents currently signed in to the instance's queues.
func (c *Client) ActiveUsers(ctx context.Context) ([]ActiveUser, error) {
	current, err := c.currentUsers.Get(ctx)
	if err != nil {
		return nil, err
	}

	users := make([]ActiveUser, 0, len(current))
	for _, u := range current {
		if u.User == nil {
			continue
		}

		var au ActiveUser
		au.UserID = aws.ToString(u.User.Id)
		if u.Status != nil {
			au.Status.Name = aws.ToString(u.Status.StatusName)
		}

		// Agents with a connected contact can still report "Available";
		// show them as on a call (AWS case 11904141851).
		if au.Status.Name == "Available" && len(u.Contacts) > 0 &&
			strings.EqualFold(string(u.Contacts[0].AgentContactState), string(types.ContactStateConnected)) {
			au.Status.Name = "On call"
		}

		detail, err := c.users.Get(ctx, au.UserID)
		if err != nil {
			return nil, err
		}
		au.User = detail

		users = append(users, au)
	}
	return users, nil
}

func (c *Client) DescribeContact(ctx context.Context, contactID string) (ContactDetail, error) {
	contact, err := c.contacts.Get(ctx, contactID)
	if err != nil {
		return ContactDetail{}, err
	}

	d := ContactDetail{
		ID:                aws.ToString(contact.Id),
		InitiationMethod:  string(contact.InitiationMethod),
		AnsweredTimestamp: aws.ToTime(contact.InitiationTimestamp),
		EndedTimestamp:    aws.ToTime(contact.LastUpdateTimestamp),
	}

	if contact.QueueInfo != nil {
		d.EnqueueTimestamp = aws.ToTime(contact.QueueInfo.EnqueueTimestamp)
	}

	if contact.AgentInfo != nil {
		connected := aws.ToTime(contact.AgentInfo.ConnectedToAgentTimestamp)
		if !connected.IsZero() {
			if !d.EnqueueTimestamp.IsZero() {
				d.QueueTime = int(connected.Sub(d.EnqueueTimestamp).Seconds())
			}
			d.CallToQueueTime = int(connected.Sub(d.AnsweredTimestamp).Seconds())
		}

		if id := aws.ToString(contact.AgentInfo.Id); id != "" {
			agent, err := c.users.Get(ctx, id)
			if err != nil {
				return ContactDetail{}, err
			}
			d.AgentName = strings.TrimSpace(agent.FirstName + " " + agent.LastName)
		}
	}

	return d, nil
}

// Snapshot returns the realtime metrics broadcast to clients.
func (c *Client) Snapshot(ctx context.Context) (map[string]any, error) {
	return c.snapshot.Get(ctx)
}

func (c *Client) fetchSnapshot(ctx context.Context) (map[string]any, error) {
	m, err := c.metrics.Get(ctx)
	if err != nil {
		return nil, err
	}
	users, err := c.ActiveUsers(ctx)
	if err != nil {
		return nil, err
	}
	handled, err := c.handledIncoming.Get(ctx)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"queue_count":        m.ContactsInQueue,
		"available_count":    m.AgentsAvailable,
		"active_agent_count": m.AgentsStaffed,
		"user_list":          users,
		"handled_incoming":   handled,
	}, nil
}

func (c *Client) fetchQueueName(ctx context.Context, queueID string) (string, error) {
	out, err := c.api.DescribeQueue(ctx, &awsconnect.DescribeQueueInput{
		InstanceId: aws.String(c.instance),
		QueueId:    aws.String(queueID),
	})
	if err != nil {
		return "", fmt.Errorf("describe queue: %w", err)
	}
	return aws.ToString(out.Queue.Name), nil
}

// SearchFlowContacts returns the inbound voice contacts initiated between
// start and end, including ones still in the contact flow or queue. Search
// results can lag real time by a few seconds. Connect caps the range at
// 8 weeks and throttles ranges over 2 weeks to 1 request per second.
func (c *Client) SearchFlowContacts(ctx context.Context, start, end time.Time) ([]FlowContact, error) {
	p := awsconnect.NewSearchContactsPaginator(c.api, &awsconnect.SearchContactsInput{
		InstanceId: aws.String(c.instance),
		TimeRange: &types.SearchContactsTimeRange{
			Type:      types.SearchContactsTimeRangeTypeInitiationTimestamp,
			StartTime: aws.Time(start),
			EndTime:   aws.Time(end),
		},
		SearchCriteria: &types.SearchCriteria{
			Channels: []types.Channel{types.ChannelVoice},
			InitiationMethods: []types.ContactInitiationMethod{
				types.ContactInitiationMethodInbound,
				types.ContactInitiationMethodTransfer,
				types.ContactInitiationMethodQueueTransfer,
			},
		},
		MaxResults: aws.Int32(100),
	})

	var contacts []FlowContact
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("search contacts: %w", err)
		}
		for _, s := range page.Contacts {
			fc := FlowContact{
				ID:             aws.ToString(s.Id),
				InitiatedAt:    aws.ToTime(s.InitiationTimestamp),
				DisconnectedAt: aws.ToTime(s.DisconnectTimestamp),
			}
			if s.QueueInfo != nil {
				fc.EnqueuedAt = aws.ToTime(s.QueueInfo.EnqueueTimestamp)
				if id := aws.ToString(s.QueueInfo.Id); id != "" {
					// A missing name shouldn't hide the call.
					fc.QueueName, _ = c.queueNames.Get(ctx, id)
				}
			}
			if s.AgentInfo != nil {
				fc.ConnectedAt = aws.ToTime(s.AgentInfo.ConnectedToAgentTimestamp)
				if id := aws.ToString(s.AgentInfo.Id); id != "" {
					if agent, err := c.users.Get(ctx, id); err == nil {
						fc.AgentName = strings.TrimSpace(agent.FirstName + " " + agent.LastName)
						fc.AgentUsername = agent.Username
					}
				}
			}
			contacts = append(contacts, fc)
		}
	}
	return contacts, nil
}

// CustomerNumber returns the caller's phone number for contactID. Unlike
// DescribeContact it isn't cached, so a contact looked up mid-flow doesn't
// leave a stale entry behind.
func (c *Client) CustomerNumber(ctx context.Context, contactID string) (string, error) {
	out, err := c.api.DescribeContact(ctx, &awsconnect.DescribeContactInput{
		InstanceId: aws.String(c.instance),
		ContactId:  aws.String(contactID),
	})
	if err != nil {
		return "", fmt.Errorf("describe contact: %w", err)
	}
	if out.Contact.CustomerEndpoint == nil {
		return "", nil
	}
	return aws.ToString(out.Contact.CustomerEndpoint.Address), nil
}
