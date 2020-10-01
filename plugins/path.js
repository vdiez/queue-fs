let path = require('path');
let sprintf = require('sprintf-js').sprintf;
let endpoint = require('./helpers/endpoint');

module.exports = actions => {
    if (!actions.hasOwnProperty('path')) actions.path = (file, params) => endpoint(file, params, 'source');
    return actions;
};