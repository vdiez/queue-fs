module.exports = (params) => {
    let actions = [];
    params.make_public = true;
    actions.push({action: "aws_s3", critical:true, params: params});
    params.request = file => ({
        url: "https://exchange-manager-api.platform.labs.pm/vl/requests",
        method: 'POST',
        headers: {
            'X-Api-Key': params.api_key
        },
        json: {
            "client_id": params.api_id,
            "name": "ingest_video_asset",
            "inputs": {
                "video_parameters": {
                    "value": new Buffer(JSON.stringify({
                        //"url": "https://s3." + params.region + ".amazonaws.com/" + params.bucket + "/" + file.filename,
                        "url": "https://" + params.bucket + ".s3.amazonaws.com/" + file.filename,
                        "assetName": file.asset_name,
                        "eventId": file.event_id,
                        "tcIn": file.time_in,
                        "duration": file.duration
                    })).toString("base64"),
                    "type": "binary"
                }
            }
        }
    });
    actions.push({action: "rest_call", critical: true, params: params});
    return actions;
};