module.exports = function Parser(type, publish) {
    let module = require('./' + type);
    let parser = Object.create(module);
    parser.publish = publish;
    return parser;
};