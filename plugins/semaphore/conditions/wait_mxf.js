let fs = require('fs-extra');

let parse_xml = function (params) {
    let result = {query: {clip_id: params.clip_id, mxf_done: true}};
    if (params.extension.toLowerCase().endsWith('mxf')) result.update = {mxf_done: true};
    return result;
};

module.exports = parse_xml;
