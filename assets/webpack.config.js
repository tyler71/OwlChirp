const path = require('path');

module.exports = {
  entry: './core.js',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, '..','app', 'static', 'lib'),
    clean: true
  },
};
