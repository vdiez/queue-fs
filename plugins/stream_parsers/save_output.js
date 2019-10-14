module.exports = {
    parser(data) {
        if (!this.data.hasOwnProperty('output')) this.data.output = "";
        this.data.output += data;
    }
};