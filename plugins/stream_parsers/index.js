module.exports = function Parser(logger, type, publish, data) {
    try {
        let module = require('./' + type);
        let parser = Object.create(module);
        parser.publish = publish;
        parser.data = data || {};
        parser.parse = data => {
            if (data instanceof Buffer) data = data.toString('utf8');
            parser.parser(data);
        };
        return parser;
    }
    catch (e) {
        logger.error("Error loading stream parser of type " + type, e);
    }
};