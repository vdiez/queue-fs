let sprintf = require('sprintf-js').sprintf;
let path = require('path');

module.exports = (file, params, endpoint) => {
    if (params?.hasOwnProperty(endpoint)) {
        let uri = sprintf(params[endpoint], file);
        if (!params[endpoint + '_is_filename']) uri = path.posix.join(uri, file.filename);
        return uri;
    }
    return path.posix.join(file.dirname, file.filename);
}