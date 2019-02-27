module.exports = function Parser(logger, type, publish, data) {
    try {
        let module = require('./' + type);
        let parser = Object.create(module);
        parser.publish = publish;
        parser.data = data || {};
        return parser;
    }
    catch (e) {
        logger.error("Error loading stream parser of type " + type, e);
    }
};