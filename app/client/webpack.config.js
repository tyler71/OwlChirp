const path = require('path');
const webpack = require('webpack');
const css = require('css-loader');
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = (env, argv) => {
    const isProduction = argv.mode === 'production';

    const pathLocation = isProduction
        ? path.resolve(__dirname, 'dist')
        : path.resolve(__dirname, '..', 'server', 'static', 'dist');


    return {
        plugins: [
            new MiniCssExtractPlugin({
                filename: "[name].[contenthash].css",
                chunkFilename: "[id].[contenthash].css" })
        ],
        optimization: {
            splitChunks: {
                maxSize: 100000,
                cacheGroups: {
                    vendor: {
                        test: /[\\/]node_modules[\\/]/,
                        name: 'vendor',
                        chunks: 'all'
                    }
                }
            }
        },
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
                },
                {
                    test: /\.css$/,
                    use: [MiniCssExtractPlugin.loader, 'css-loader']
                },
            ]
        },
        mode: argv.mode,
        entry: path.resolve(__dirname, 'core.js'),
        output: {
            filename: '[name].[contenthash].js',
            path: pathLocation,
            clean: true
        },
    }
};
