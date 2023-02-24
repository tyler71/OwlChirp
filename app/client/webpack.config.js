const path = require('path');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    const pathLocation = isProduction
        ? path.resolve(__dirname, 'dist')
        : path.resolve(__dirname, '..', 'server', 'static', 'dist');

    return {
        mode: argv.mode,
        entry: path.resolve(__dirname, 'core.js'),
        output: {
            filename: 'main.[fullhash].js',
            path: pathLocation,
            clean: true
        },
    }
};
