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
                url: ((base, public_id, public_key) => {
                    let id = "myWebServiceID=" + public_id;
                    let timestamp = "timeStamp=" + require('moment')().format('X');
                    return base + "?" + id + "&" + timestamp + "&footprint=" + encodeURIComponent(require('crypto').createHmac('sha1', public_key).update(id + "&secretKey=" + public_key + "&" + timestamp).digest('base64'))
                })('https://back-better.ebu.ch/api/v2/medias', params.api_id, params.api_key),
                    method: 'POST',
                    json: {
                    "name": file.filename,
                        "description": file.clip_id,
                        "category": 1462,
                        "fileUrl": "https://" + params.bucket + ".s3.amazonaws.com/" + path.posix.normalize(target)
                }
            }
        }
    }});
    return actions;
};