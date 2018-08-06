module.exports = params => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    actions.push({id: "wochit_token", action: "rest_call", critical: true, params: {request: {
        url: "https://ingest-api.wochit.com/api/v1/oauth/access_token",
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + new Buffer(params.api_id + ":" + params.api_secret).toString("base64"),
            'x-api-key': params.api_key
        }
    }}});
    actions.push({action: "rest_call", critical: true, params: file => {
        let path = require('path');
        let sprintf = require('sprintf-js').sprintf;
        let target = params.target || './';
        target = sprintf(target, file);
        if (!params.target_is_filename) target = path.posix.join(target, file.filename);
        return {
            request: {
                url: "https://ingest-api.wochit.com/api/v1/assets",
                    method: 'POST',
                    headers: {
                    'Authorization': 'Bearer ' + JSON.parse(file.results['wochit_token']).token,
                        'x-api-key': params.api_key
                },
                json: {
                    "mediaProviderAssetModels": [
                        {
                            "id": file.filename,
                            "downloadUrl": "http://" + params.bucket + ".s3.amazonaws.com/" + path.posix.normalize(target),
                            "type": "VIDEO",
                            "title": file.filename,
                            "caption": file.filename,
                            "publicationDate": require('moment')().utc().format(),
                            "contentType": "Editorial"
                        }
                    ]
                }
            }
        }
    }});
    return actions;
};