module.exports = function Parser(type, publish) {
    let type = require('./' + type);
    let parser = Object.create(type);
    parser.publish = publish;
    return parser;
};