module.exports = function Parser(type, publish, data) {
    try {
        let module = require('./' + type);
        let parser = Object.create(module);
        parser.publish = publish;
        parser.data = data || {};
        return parser;
    }
    catch (e) {console.log(e)}
};