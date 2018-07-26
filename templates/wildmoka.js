let fs = require('fs-extra');

module.exports = params => {
    let actions = [];
    actions.push({action: "ftp", critical:true, params: file => {
        params.host = "ftp.us.wildmoka.com";
        params.direct = true;
        params.secure = true;
        params.target = "%(file)s";
        return params;
    }});
    actions.push({action: "ftp", critical: true, params: file => {
        let path = require('path');
        let sprintf = require('sprintf-js').sprintf;
        let target = "%(file)s";
        target = sprintf(target, file);
        let contents = {
            "title": file.asset_name,
            "create_clip": true,
            "data_file": path.posix.normalize(target),
            "mark_as_decorator": false
        };
        return fs.writeFile(path.posix.join(file.dirname, file.filename + ".json"), JSON.stringify(contents))
            .then(() => {
                params.source = path.posix.join(file.dirname, file.filename + ".json");
                params.source_is_filename = true;
                params.target = path.posix.normalize(target) + ".json";
                return params;
            });
    }});
    return actions;
};