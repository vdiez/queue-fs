module.exports = {
    parser(data) {
        let match_audio_channels = data.match(/(\d+)/);
        if (match_audio_channels) this.data.audio_channels = match_audio_channels[1];
    }
};