'use strict';

function Common(options) {
  this.log = options.log;
}

Common.prototype.notReady = function (err, res, p) {
  res.status(503).send('Server not yet ready. Sync Percentage:' + p);
};

Common.prototype.handleErrors = function (err, res) {
  if (err) {
    if (err.code)  {
      res.status(400).send({ status: "error", message: err.message + '. Code:' + err.code, fee: err.fee, expectedFee: err.expected_fee});
    } else {
      this.log.error(err.stack);
      res.status(503).send({ status: "error", message: err.message });
    }
  } else {
    res.status(404).send({ status: "error", message: 'Not found' });
  }
};

//@ntr upgrade INSIGHT23
Common.prototype.validateNullArguments = function(args){
  for(var name in args){
    if(args.hasOwnProperty(name)){
      if(args[name] == null)
        return "The " + name + " parameter is required.";
    }
  }
  
  return null;
};

module.exports = Common;
