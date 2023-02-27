const path = require('path');
const webpack = require('webpack');

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    const pathLocation = isProduction
        ? path.resolve(__dirname, 'dist')
        : path.resolve(__dirname, '..', 'server', 'static', 'dist');

    return {
        module: {
            rules: [
                {
                    test: /const\.js$/,
                    loader: 'string-replace-loader',
                    options: {
                        multiple: [
                            {
                                search: '_REPLACE_CONNECT_DOMAIN',
                                replace: process.env.CONNECT_DOMAIN,
                                strict: true
                            },
                            {
                                search: '_REPLACE_TIME_ZONE',
                                replace: process.env.TIME_ZONE,
                                strict: true
                            },
                        ]
                    },
                }
            ]
        },
        mode: argv.mode,
        entry: path.resolve(__dirname, 'core.js'),
        output: {
            filename: 'main.[fullhash].js',
            path: pathLocation,
            clean: true
        },
    }
};
