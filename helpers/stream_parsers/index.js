module.exports = function Parser(type, publish) {
    let module = require('./' + type);
    let parser = Object.create(module);
    parser.publish = publish;
    parser.data = {};
    return parser;
};