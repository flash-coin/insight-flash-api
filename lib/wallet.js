'use strict';

var bitcore = require('flashcore-lib'); //@ntr upgrade Insight2-3
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Common = require('./common');

var TxController = require('./transactions');
var AddressController = require('./addresses');

var unityCoin = 1e-8;
var flashCoin = 1e10; // 10,000,000, satoshis --> 10,000,000,000 satoshis
var defaultFee = 10000;
var defaultWebWalletFee = 0.001*flashCoin;

function WalletController(node) {
  this.node = node;
  this.txController = new TxController(node);
	this.AddressController = new AddressController(node);
	this.common = new Common({log: this.node.log});
}

/**
* Creates a new wallet and returns an instance of type {privateKey:String, publicKey: String, publicAddress: String}
* */
WalletController.prototype.createWallet = function(req, res) {
	var network = bitcore.Networks[this.node.network];

	var privateKey = new bitcore.PrivateKey();
	var publicKey = privateKey.toPublicKey();
    var publicAddress = publicKey.toAddress(network);

	var obj = {
		privateKey: privateKey.toString(),
		publicKey: publicKey.toString(),
		publicAddress: publicAddress.toString(),
	};

	res.jsonp(obj);
};

/**
 * Gets balance, including confirmed balance and unconfirmed balance of specified address.
 * */
WalletController.prototype.getBalance = function (req, res) {
	var self = this;
	var addr = req.params.addr;
	var options = {
		noTxList: parseInt(req.query.noTxList)
	};

	this.AddressController.getAddressSummary(addr, options, function(err, data) {
		if(err) {
		return self.common.handleErrors(err, res);
		}
		res.jsonp({ balance: data.balance, ubalance: data.unconfirmedBalance});
	});
};

/**
 * Gets balance, including confirmed balance and unconfirmed balance of specified address.
 * */
WalletController.prototype.getBalance_old = function (req, res) {
	var self = this;
	var addr = req.params.addr;
	var SendingBalance = 0;
	var ConfirmedBalance = 0;
	var UnconfirmedBalance = 0;
	var TotalBalance = 0;

	this.node.getAddressMempool([addr], function(err, txsmp){
		if(err) {
			txsmp = [];
		} else if(err) {
			return self.common.handleErrors(err, res);
		}

		// Caculate Sending Balance
		//console.log('txsmp:', txsmp);
		for (var i = 0; i < txsmp.length; i++) {
			if(txsmp[i].satoshis < 0) {
				SendingBalance = SendingBalance + txsmp[i].satoshis;
				for (var j = 0; j < txsmp.length; j++) {
					if(txsmp[j].satoshis > 0 && (txsmp[j].txid==txsmp[i].txid) && (txsmp[j].ignore != 1)) {
						SendingBalance = SendingBalance + txsmp[j].satoshis;
						txsmp[j].ignore = 1;
					}
				}
			}
		}	
		//console.log('SBalalane:', SendingBalance);
		
		// Get UTXOS for caculating Confirmed Balance and Unconfirmed Balance
		self.node.getAddressUnspentOutputs(addr, true, function(err, utxos) {
			if(err) {
				utxos = [];
			} else if(err) {
				return self.common.handleErrors(err, res);
			}

			//Caculate ConfirmedBalance & UnconfirmedBalance
			utxos.forEach(function (tx) {
				tx = self.AddressController.transformUtxo(tx);
				if (tx.confirmations > 2) {
					ConfirmedBalance += tx.satoshis;
				}else{
					UnconfirmedBalance += tx.satoshis;
				}
			});

			// Caculate Total Balance:
			TotalBalance = ConfirmedBalance + UnconfirmedBalance - SendingBalance;

			ConfirmedBalance = ConfirmedBalance / flashCoin;
			UnconfirmedBalance = UnconfirmedBalance / flashCoin;
			SendingBalance = SendingBalance / flashCoin;
			TotalBalance = TotalBalance / flashCoin;

			res.jsonp({ totalBalance: TotalBalance, confirmedBalance: ConfirmedBalance, unconfirmedBalance: UnconfirmedBalance, sendingBalance: SendingBalance});
		});
	});
};

/**
 * Executes transaction.
 * @from String The from address.
 * @to String The to address.
 * @amount Number The amount need to be transfered.
 * @pkey String The private key.
 * */
WalletController.prototype.sendTx = function (req, res) {
	var self = this;
	var fromAddrString = req.body.from_public_address,
		toAddrString = req.body.to_public_address,
		amount = req.body.amount,
		privateKey = req.body.private_key;

	var err = self.common.validateNullArguments({ from: fromAddrString, to: toAddrString, amount: amount, pkey: privateKey });
	if (err) return self.common.handleErrors(err, res);

	try {
      amount = Math.round(parseFloat(amount) * flashCoin);
      var toAddr = new bitcore.Address(toAddrString);
      var fromAddr = new bitcore.Address(fromAddrString);
    } catch(e) {
      return self.common.handleErrors({
        message: 'Invalid address: ' + e.message,
        code: 1
      }, res);
    }

	this.node.getAddressUnspentOutputs(fromAddrString, true, function(err, utxos) {
		if(err && err instanceof self.node.errors.NoOutputs) {
			utxos = [];
		} else if(err) {
			return self.common.handleErrors(err, res);
		}

		var total = 0;
    var suggest_utxos = [];
		utxos.forEach(function (tx) {
			tx = self.AddressController.transformUtxo(tx);
      if (tx.confirmations > 2) {
        if (total < (amount + defaultFee)) suggest_utxos.push(tx);
        total += tx.satoshis;
      }
		});


		if (total < amount + defaultFee) {
			return self.common.handleErrors({ message: "Not enough money", code: 1 }, res);
		}

		var transaction = new bitcore.Transaction()
		.from(suggest_utxos)          // Feed information about what unspent outputs one can use
		.to(toAddrString, amount)  // Add an output with the given amount of satoshis
		.change(fromAddrString)      // Sets up a change address where the rest of the funds will go
		.sign(privateKey)     // Signs all the inputs it can

		//console.log('transaction.serialize()', transaction.serialize(true));

		self.node.sendTransaction(transaction.serialize(true), function(err, txid) {
			if(err) {
			  // TODO handle specific errors
			  return self.common.handleErrors(err, res);
			}

			res.json({'txid': txid});
		});
	});
};

/**
 * Gets a transaction in details.
 * @txid String The specified transction id.
 */
WalletController.prototype.getTxInfo = function (req, res) {
	var self = this;
	var txid = req.params.txid;
	var err = self.common.validateNullArguments({ txid: txid });
	if (err) return self.common.handleErrors(err, res);

	this.node.getDetailedTransaction(txid, function(err, transaction) {
		if (err && err instanceof self.node.errors.Transaction.NotFound) {
			return self.common.handleErrors(null, res);
		} else if(err) {
			return self.common.handleErrors(err, res);
		}

		self.txController.transformTransaction(transaction, function(err, transformedTransaction) {
      if (err) {
        return self.common.handleErrors(err, res);
      }
      res.jsonp(transformedTransaction);
		});

	});
};

WalletController.prototype.createUnsigedRawTransaction = function (req, res) {
	var self = this;
	var fromAddrString = req.body.from_public_address,
		toAddrString = req.body.to_public_address,
		amount = req.body.amount,
    customFee = req.body.custom_fee;

	var err = self.common.validateNullArguments({ from: fromAddrString, to: toAddrString, amount: amount, fee: customFee });
	if (err) return self.common.handleErrors(err, res);

	try {
      amount = Math.round(parseFloat(amount) * flashCoin);
      customFee = Math.round(parseFloat(customFee) * flashCoin);
      var toAddr = new bitcore.Address(toAddrString);
      var fromAddr = new bitcore.Address(fromAddrString);
    } catch(e) {
      return self.common.handleErrors({
        message: 'Invalid address: ' + e.message,
        code: 1
      }, res);
    }
    
    if(customFee == 0) customFee = defaultWebWalletFee;	//WL should remove when update FWW
	  if(customFee > 0) defaultFee =  customFee;
	
	this.node.getAddressUnspentOutputs(fromAddrString, true, function(err, utxos) {
		if(err && err instanceof self.node.errors.NoOutputs) {
			utxos = [];
		} else if(err) {
			return self.common.handleErrors(err, res);
		}

		var total = 0;
    var suggest_utxos = [];
		utxos.forEach(function (tx) {
			tx = self.AddressController.transformUtxo(tx);
      if (tx.confirmations > 0) {
        if (total < (amount + defaultFee)) suggest_utxos.push(tx);
        total += tx.satoshis;
      }
		});

		if (total < amount  + defaultFee ) {
			return self.common.handleErrors({ message: "Not enough money", code: 1 }, res);
		}

		var transaction = new bitcore.Transaction()
		.from(suggest_utxos)          // Feed information about what unspent outputs one can use
		.to(toAddrString, amount);  // Add an output with the given amount of satoshis

    if(customFee > 0) {
       transaction = transaction.fee(customFee); // Add customFee
    }

		transaction = transaction.change(fromAddrString);      // Sets up a change address where the rest of the funds will go

		var rawtx = transaction.serialize(true);
		var txid = transaction._getHash().toString('hex');

		res.jsonp({status: 'success', data: {raw: rawtx, txid: txid}, code:'200', message:''});
	});
};

WalletController.prototype.createUnsigedRawTransactionMulti = function (req, res) {
	var self = this;
	var fromAddrString = req.body.from_public_address,
		toAddrs = req.body.to_addresses,
		//privateKey = req.body.private_key,
		customFee = req.body.custom_fee;
	
	// Check to address format	
	try {
		toAddrs = JSON.parse(toAddrs);
	} catch(e) {
		return self.common.handleErrors({
			message: 'Invalid address: ' + e.message,
			code: 1
		}, res);
	}

	// Check valid input params
	var err = self.common.validateNullArguments({ from: fromAddrString, fee: customFee });
	if (err) return self.common.handleErrors(err, res);

	try {
		//amount = Math.round(parseFloat(amount) * flashCoin);
		customFee = Math.round(parseFloat(customFee) * flashCoin);
		//var toAddr = new bitcore.Address(toAddrString);
		var fromAddr = new bitcore.Address(fromAddrString);
	} catch(e) {
		return self.common.handleErrors({
			message: 'Invalid input params: ' + e.message,
			code: 1
		}, res);
	}

	// Check valid to addresses
	var toAddresses = [];
	var totalAmount = 0;
	toAddrs.forEach(function(outAddr){
		var err = self.common.validateNullArguments({ address: outAddr.address, satoshis: outAddr.amount });
		if (err) return self.common.handleErrors(err, res);
		try{
			var amount = Math.round(parseFloat(outAddr.amount) * flashCoin);
			var address = new bitcore.Address(outAddr.address);
			toAddresses.push({address: outAddr.address, satoshis: amount})
			totalAmount = totalAmount + amount;
		} catch(e) {
			return self.common.handleErrors({
				message: 'Invalid to addresses: ' + e.message,
				code: 1
			}, res);
		}
	});

  if(customFee > 0) defaultFee =  customFee;
	this.node.getAddressUnspentOutputs(fromAddrString, true, function(err, utxos) {
		if(err && err instanceof self.node.errors.NoOutputs) {
			utxos = [];
		} else if(err) {
			return self.common.handleErrors(err, res);
		}

		var total = 0;
    var suggest_utxos = [];
		utxos.forEach(function (tx) {
			tx = self.AddressController.transformUtxo(tx);
      if (tx.confirmations > 0) {
        if (total < (totalAmount + defaultFee)) suggest_utxos.push(tx);
        total += tx.satoshis;
      }
		});

		if (total < totalAmount  + defaultFee ) {
			return self.common.handleErrors({ message: "Not enough money", code: 1 }, res);
		}

		var transaction = new bitcore.Transaction()
		.from(suggest_utxos)          // Feed information about what unspent outputs one can use
		.to(toAddresses);  // Add an output with the given amount of satoshis

    if(customFee > 0) {
       transaction = transaction.fee(customFee); // Add customFee
    }

		transaction = transaction.change(fromAddrString);      // Sets up a change address where the rest of the funds will go
		//transaction = transaction.sign(privateKey)     // Signs all the inputs it can

		var rawtx = transaction.serialize(true);
		var txid = transaction._getHash().toString('hex');

		res.jsonp({status: 'success', data: {raw: rawtx, txid: txid}, code:'200', message:''});
	});
};


module.exports = WalletController;
