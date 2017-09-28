let parse_xml = function (file) {
    let result = {query: {clip_id: file.clip_id, mxf_done: true}};
    if (file.extension.toLowerCase().endsWith('mxf')) result.update = {mxf_done: true};
    return result;
};

module.exports = parse_xml;
