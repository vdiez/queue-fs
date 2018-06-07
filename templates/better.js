module.exports = (params) => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    params.request = file => ({
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
            "fileUrl": "https://" + params.bucket + ".s3.amazonaws.com/" + file.filename
        }
    });
    actions.push({action: "rest_call", critical: true, params: params});
    return actions;
};