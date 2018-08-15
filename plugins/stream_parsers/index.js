let winston = require('winston');

module.exports = function Parser(type, publish, data) {
    try {
        let module = require('./' + type);
        let parser = Object.create(module);
        parser.publish = publish;
        parser.data = data || {};
        return parser;
    }
    catch (e) {
        winston.error("Error loading stream parser of type " + type, e);
    }
};