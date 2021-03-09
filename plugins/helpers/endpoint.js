let sprintf = require('sprintf-js').sprintf;
let path = require('path');
let defaults = {source: '%(dirname)s', target: ''}

module.exports = (file, params, endpoint) => {
    let uri = sprintf((params?.hasOwnProperty(endpoint)) ? params[endpoint] : defaults[endpoint], file);
    if (params[endpoint + '_is_filename'] === false) uri = path.posix.join(uri, file.filename);
    return uri;
}