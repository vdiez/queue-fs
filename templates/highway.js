module.exports = params => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    actions.push({action: "rest_call", critical: true, params: file => {
        let path = require('path');
        let target = params.target || './';
        target = sprintf(target, file);
        if (!params.target_is_filename) target = path.posix.join(target, file.filename);
        return {
            request: {
                url: "http://hac.eurovision-highway.tv/create-entry/",
                    method: 'POST',
                    json: {
                    "userId": params.username,
                        "userPassword": params.password,
                        "fileName": path.posix.normalize(target),
                        "entryName": file.clip_id,
                        "entryDescription": file.clip_id,
                        "entryFederation": params.federation
                }
            }
        }
    }});
    return actions;
};