module.exports = (params) => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    actions.push({action: "rest_call", critical: true, params: file => ({
        request: {
            url: "http://hac.eurovision-highway.tv/create-entry/",
            method: 'POST',
            json: {
                "userId": params.username,
                "userPassword": params.password,
                "fileName": file.filename,
                "entryName": file.clip_id,
                "entryDescription": file.clip_id,
                "entryFederation": params.federation
            }
        }
    })});
    return actions;
};