let fs = require('fs-extra');
let path = require('path');

module.exports = (params, config) => {
    let actions = [];
    actions.push({action: "ftp", critical:true, params: file => {
        params.host = "ftp.us.wildmoka.com";
        params.direct = true;
        params.secure = true;
        return params;
    }});
    actions.push({action: "ftp", critical: true, params: file =>
        fs.stat(path.posix.join(file.dirname, file.clip_id + ".json"))
            .catch(err => {
                let contents = {
                    "title": file.asset_name,
                    "create_clip": true,
                    "data_file": file.filename,
                    "mark_as_decorator": false
                };
                return fs.writeFile(path.posix.join(file.dirname, file.clip_id + ".json"), JSON.stringify(contents));
            })
            .then(() => {
                params.source = path.posix.join(file.dirname, file.clip_id + ".json");
                params.source_is_filename = true;
                params.target = file.clip_id + ".json";
                return params;
            })
    });
    return actions;
};