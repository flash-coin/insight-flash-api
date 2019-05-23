'use strict';

var bitcore = require('flashcore-lib'); //@ntr upgrade Insight2-3
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var Common = require('./common');
var BigNumber = require('bignumber.js');

var TxController = require('./transactions');
var AddressController = require('./addresses');

BigNumber.set({ DECIMAL_PLACES: 20, ROUNDING_MODE: 1 })

var unityCoin = 1e-8;
var flashCoin = 1e10; // 10,000,000, satoshis --> 10,000,000,000 satoshis
var defaultFee = 10000;
var defaultWebWalletFee = 0.001 * flashCoin;

// Array of fee per kb (in satoshi)
var arFeeRateDefault = {
	high: 220,
	medium: 180,
	low: 140
}

function WalletController(node) {
	this.node = node;
	this.txController = new TxController(node);
	this.AddressController = new AddressController(node);
	this.common = new Common({ log: this.node.log });
}

/**
* Creates a new wallet and returns an instance of type {privateKey:String, publicKey: String, publicAddress: String}
* */
WalletController.prototype.createWallet = function (req, res) {
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

	this.AddressController.getAddressSummary(addr, options, function (err, data) {
		if (err) {
			return self.common.handleErrors(err, res);
		}
		res.jsonp({ balance: data.balance, ubalance: data.unconfirmedBalance });
	});
};

/**
 * Gets balance, including confirmed balance and unconfirmed balance of specified address.
 * */
WalletController.prototype.getBalance_newversion = function (req, res) {
	var self = this;
	var addr = req.params.addr;
	var SendingBalance = 0;
	var ConfirmedBalance = 0;
	var UnconfirmedBalance = 0;
	var TotalBalance = 0;

	this.node.getAddressMempool([addr], function (err, txsmp) {
		if (err) {
			txsmp = [];
		} else if (err) {
			return self.common.handleErrors(err, res);
		}

		// Caculate Sending Balance
		//console.log('txsmp:', txsmp);
		for (var i = 0; i < txsmp.length; i++) {
			if (txsmp[i].satoshis < 0) {
				SendingBalance = SendingBalance + txsmp[i].satoshis;
				for (var j = 0; j < txsmp.length; j++) {
					if (txsmp[j].satoshis > 0 && (txsmp[j].txid == txsmp[i].txid) && (txsmp[j].ignore != 1)) {
						SendingBalance = SendingBalance + txsmp[j].satoshis;
						txsmp[j].ignore = 1;
					}
				}
			}
		}
		//console.log('SBalalane:', SendingBalance);

		// Get UTXOS for caculating Confirmed Balance and Unconfirmed Balance
		self.node.getAddressUnspentOutputs(addr, true, function (err, utxos) {
			if (err) {
				utxos = [];
			} else if (err) {
				return self.common.handleErrors(err, res);
			}

			//Caculate ConfirmedBalance & UnconfirmedBalance
			utxos.forEach(function (tx) {
				tx = self.AddressController.transformUtxo(tx);
				if (tx.confirmations > 0) {
					ConfirmedBalance += tx.satoshis;
				} else {
					UnconfirmedBalance += tx.satoshis;
				}
			});

			// Caculate Total Balance:
			TotalBalance = ConfirmedBalance + UnconfirmedBalance - SendingBalance;

			ConfirmedBalance = ConfirmedBalance / flashCoin;
			UnconfirmedBalance = UnconfirmedBalance / flashCoin;
			SendingBalance = SendingBalance / flashCoin;
			TotalBalance = TotalBalance / flashCoin;

			res.jsonp({ totalBalance: TotalBalance, confirmedBalance: ConfirmedBalance, unconfirmedBalance: UnconfirmedBalance, sendingBalance: SendingBalance });
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
		var amountBN = BigNumber(amount).multipliedBy(flashCoin).integerValue();
		var toAddr = new bitcore.Address(toAddrString);
		var fromAddr = new bitcore.Address(fromAddrString);
	} catch (e) {
		return self.common.handleErrors({
			message: 'Invalid address: ' + e.message,
			code: 1
		}, res);
	}

	defaultFee = BigNumber(defaultFee);
	var utxoCapBN = amountBN.plus(defaultFee);

	this.node.getAddressUnspentOutputs(fromAddrString, true, function (err, utxos) {
		if (err && err instanceof self.node.errors.NoOutputs) {
			utxos = [];
		} else if (err) {
			return self.common.handleErrors(err, res);
		}

		var totalBN = BigNumber(0);
		var suggest_utxos = [];
		utxos.forEach(function (tx) {
			tx = self.AddressController.transformUtxo(tx);
			if (tx.confirmations > 0) {
				if (totalBN.isLessThan(utxoCapBN)) suggest_utxos.push(tx);
				totalBN = totalBN.plus(tx.satoshis);
			}
		});

		if (totalBN.isLessThan(utxoCapBN)) {
			return self.common.handleErrors({ message: "Not enough money", code: 1 }, res);
		}

		var transaction = new bitcore.Transaction()
			.from(suggest_utxos)          // Feed information about what unspent outputs one can use
			.to(toAddrString, amountBN.toNumber()) // Add an output with the given amount of satoshis
			.change(fromAddrString)      // Sets up a change address where the rest of the funds will go
			.sign(privateKey)     // Signs all the inputs it can

		self.node.sendTransaction(transaction.serialize(true), function (err, txid) {
			if (err) {
				// TODO handle specific errors
				return self.common.handleErrors(err, res);
			}

			res.json({ 'txid': txid });
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

	this.node.getDetailedTransaction(txid, function (err, transaction) {
		if (err && err instanceof self.node.errors.Transaction.NotFound) {
			return self.common.handleErrors(null, res);
		} else if (err) {
			return self.common.handleErrors(err, res);
		}

		self.txController.transformTransaction(transaction, function (err, transformedTransaction) {
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
		customFee = req.body.custom_fee,
		disableCheckDustOutputs = req.body.disable_check_dust_output,
		dustPref = req.body.dust_pref,
		feePref = req.body.fee_pref;

	var nConfirmExpect = 6;
	var _feePerKb = arFeeRateDefault.high;

	if (dustPref && dustPref > 0) {
		dustPref = 1; // move dust output to sending amount
	} else {
		dustPref = 0; // move dust output to fee
	}

	if (feePref && feePref > 0) {
		if (feePref == 1) {
			nConfirmExpect = 6;
			_feePerKb = arFeeRateDefault.high;
		} else if (feePref == 2) {
			nConfirmExpect = 12;
			_feePerKb = arFeeRateDefault.medium;
		} else {
			nConfirmExpect = 24;
			_feePerKb = arFeeRateDefault.low;
		}
	} else {
		nConfirmExpect = 6;
		_feePerKb = arFeeRateDefault.high;
	}

	if (disableCheckDustOutputs && disableCheckDustOutputs > 0) {
		disableCheckDustOutputs = 1; // don't check the dust ouput
	} else {
		disableCheckDustOutputs = 0; // let check the dust ouput
	}

	var err = self.common.validateNullArguments({ from: fromAddrString, to: toAddrString, amount: amount, fee: customFee });
	if (err) return self.common.handleErrors(err, res);

	try {
		var amountBN = BigNumber(amount).multipliedBy(flashCoin).integerValue();
		var customFeeBN = BigNumber(customFee).multipliedBy(flashCoin).integerValue();
		var toAddr = new bitcore.Address(toAddrString);
		var fromAddr = new bitcore.Address(fromAddrString);
	} catch (e) {
		return self.common.handleErrors({
			message: 'Invalid address: ' + e.message,
			code: 1
		}, res);
	}

	//Check Dust inputs
	if (amountBN.isLessThan(546)) {
		return self.common.handleErrors({
			message: 'Sending amount is less than DUST_AMOUNT [546 sat]',
			code: 1
		}, res);
	}

	this.node.estimateFee(nConfirmExpect, function (err, feeRateEstimate) {
		if (err) {
			console.log('estimateFee', err)
			//return self.common.handleErrors(err, res);
		}
		console.log('estimateFee', feeRateEstimate)
		if (feeRateEstimate > 0) {
			_feePerKb = BigNumber(feeRateEstimate).multipliedBy(flashCoin).toNumber();
		}

		var transaction = new bitcore.Transaction();

		//if (customFeeBN.isEqualTo(0)) customFeeBN = BigNumber(defaultWebWalletFee);	//WL should remove when update FWW
		if (customFeeBN.isGreaterThan(0)) {
			transaction = transaction.fee(customFeeBN.toNumber()); // Add customFee
		} else {
			transaction = transaction.feePerKb(_feePerKb);
		}

		defaultFee = transaction._estimateFee() / 2; // getFee();
		var utxoCapBN = amountBN.plus(defaultFee);

		self.node.getAddressUnspentOutputs(fromAddrString, true, function (err, utxos) {
			if (err && err instanceof self.node.errors.NoOutputs) {
				utxos = [];
			} else if (err) {
				return self.common.handleErrors(err, res);
			}

			var totalBN = BigNumber(0);
			var remainBN = BigNumber(0);
			var suggest_utxos = [];
			var remainBN;
			utxos.forEach(function (tx) {
				tx = self.AddressController.transformUtxo(tx);
				if (tx.confirmations > 0) {
					if (totalBN.isLessThan(utxoCapBN)) {
						suggest_utxos.push(tx);
						totalBN = totalBN.plus(tx.satoshis);
					} else {
						remainBN = totalBN.minus(utxoCapBN);
						// if output is maybe a dust then include more utxo
						if (remainBN.isGreaterThan(0) && remainBN.isLessThan(546)) {
							suggest_utxos.push(tx);
							totalBN = totalBN.plus(tx.satoshis);
						}
					}
				}
			});

			if (totalBN.isLessThan(utxoCapBN)) {
				return self.common.handleErrors({ message: "Not enough money", code: 1 }, res);
			}

			transaction = transaction
				.from(suggest_utxos)          // Feed information about what unspent outputs one can use
				.to(toAddrString, amountBN.toNumber())  // Add an output with the given amount of satoshis
				.change(fromAddrString);      // Sets up a change address where the rest of the funds will go

			// Check Serialize Transaction: if return error we will have to process more
			var serialize_opts = {
				disableSmallFees: false,
				disableLargeFees: false,
				disableIsFullySigned: true,
				disableMoreOutputThanInput: true
			}
			if (disableCheckDustOutputs == 1) {
				serialize_opts.disableDustOutputs = true;
			} else {
				serialize_opts.disableDustOutputs = false;
			}

			var warningMessage;
			var dustAction = null;

			var hasDustOutput = transaction._hasDustOutputs(serialize_opts);
			if (hasDustOutput) {
				// Remove dust input (changeInput)
				var changeOutput = transaction.getChangeOutput();
				var changeOutputIndex = transaction._changeIndex;
				if (changeOutput) {
					transaction.removeOutput(transaction._changeIndex);
				}
				var transactionNew = new bitcore.Transaction()
					.from(suggest_utxos)          // Feed information about what unspent outputs one can use

				if (customFeeBN.isGreaterThan(0)) {
					transactionNew = transactionNew.fee(customFeeBN.toNumber()); // Add customFee
				} else {
					transactionNew = transactionNew.feePerKb(_feePerKb);
					//transactionNew = transactionNew.fee(defaultWebWalletFee); // Add default customFee
				}

				if (dustPref == 0) {
					// move dust output to transaction fee
					dustAction = 0;
					warningMessage = 'Dust Input (index:' + changeOutputIndex + ', value:' + changeOutput.satoshis + ' sat) was removed & included to tx-fee';
				} else {
					// move dust output to sending amount
					dustAction = 1;
					amountBN = amountBN.plus(changeOutput.satoshis);
					warningMessage = 'Dust Input (index:' + changeOutputIndex + ', value:' + changeOutput.satoshis + ' sat) was removed & included to sending amount';
				}

				transactionNew.to(toAddrString, amountBN.toNumber());  // Add an output with the given amount of satoshis


				transaction = transactionNew;
			}

			var feeError = transaction._hasFeeError(serialize_opts, transaction._getUnspentValue());
			if (feeError) {
				warningMessage += feeError;
			}

			var rawtx = transaction.serialize(true);  // serialize (unsafe) {true:, false:}
			var txid = transaction._getHash().toString('hex');
			var fee = transaction._getUnspentValue(); //transaction.getFee();

			res.jsonp({ status: 'success', data: { raw: rawtx, txid: txid, fee: fee, feePerKb: _feePerKb }, code: '200', message: '', dustAction: dustAction, warningMessage: warningMessage });
		});
	});
};

WalletController.prototype.createUnsigedRawTransactionMulti = function (req, res) {
	var self = this;
	var fromAddrString = req.body.from_public_address,
		toAddrs = req.body.to_addresses,
		//privateKey = req.body.private_key,
		disableCheckDustOutputs = req.body.disable_check_dust_output,
		customFee = req.body.custom_fee,
		feePref = req.body.fee_pref;

	var nConfirmExpect = 6;
	var _feePerKb = arFeeRateDefault.high;

	if (disableCheckDustOutputs && disableCheckDustOutputs > 0) {
		disableCheckDustOutputs = 1; // don't check the dust ouput
	} else {
		disableCheckDustOutputs = 0; // let check the dust ouput 
	}

	if (feePref && feePref > 0) {
		if (feePref == 1) {
			nConfirmExpect = 6;
			_feePerKb = arFeeRateDefault.high;
		} else if (feePref == 2) {
			nConfirmExpect = 12;
			_feePerKb = arFeeRateDefault.medium;
		} else {
			nConfirmExpect = 24;
			_feePerKb = arFeeRateDefault.low;
		}
	} else {
		nConfirmExpect = 6;
		_feePerKb = arFeeRateDefault.high;
	}

	// Check to address format	
	try {
		toAddrs = JSON.parse(toAddrs);
	} catch (e) {
		return self.common.handleErrors({
			message: 'Invalid address: ' + e.message,
			code: 1
		}, res);
	}

	// Check valid input params
	var err = self.common.validateNullArguments({ from: fromAddrString, fee: customFee });
	if (err) return self.common.handleErrors(err, res);

	try {
		var customFeeBN = BigNumber(customFee).multipliedBy(flashCoin).integerValue();
		var fromAddr = new bitcore.Address(fromAddrString);
	} catch (e) {
		return self.common.handleErrors({
			message: 'Invalid input params: ' + e.message,
			code: 1
		}, res);
	}

	// Check valid to addresses
	var toAddresses = [];
	var totalAmountBN = BigNumber(0);
	toAddrs.forEach(function (outAddr) {
		var err = self.common.validateNullArguments({ address: outAddr.address, satoshis: outAddr.amount });
		if (err) return self.common.handleErrors(err, res);
		try {
			var amountBN = BigNumber(outAddr.amount).multipliedBy(flashCoin).integerValue();
			var address = new bitcore.Address(outAddr.address);
			toAddresses.push({ address: outAddr.address, satoshis: amountBN.toNumber() })
			totalAmountBN = totalAmountBN.plus(amountBN);
			//Check Dust inputs
			if (amountBN.isLessThan(546)) {
				return self.common.handleErrors({
					message: 'One of the sending outputs amount is less than DUST_AMOUNT [546 sat]',
					code: 1
				}, res);
			}
		} catch (e) {
			return self.common.handleErrors({
				message: 'Invalid to addresses: ' + e.message,
				code: 1
			}, res);
		}
	});

	this.node.estimateFee(nConfirmExpect, function (err, feeRateEstimate) {
		if (err) {
			console.log('estimateFee', err)
			//return self.common.handleErrors(err, res);
		}
		console.log('estimateFee', feeRateEstimate)
		if (feeRateEstimate > 0) {
			_feePerKb = BigNumber(feeRateEstimate).multipliedBy(flashCoin).toNumber();
		}

		var transaction = new bitcore.Transaction();

		// if (customFeeBN.isEqualTo(0)) customFeeBN = BigNumber(defaultWebWalletFee);	//WL should remove when update FWW
		if (customFeeBN.isGreaterThan(0)) {
			transaction = transaction.fee(customFeeBN.toNumber()); // Add customFee
		} else {
			transaction = transaction.feePerKb(_feePerKb);
			// transaction = transaction.fee(defaultWebWalletFee); // Add default customFee
		}

		defaultFee = transaction._estimateFee() / 2;
		var utxoCapBN = totalAmountBN.plus(defaultFee);

		self.node.getAddressUnspentOutputs(fromAddrString, true, function (err, utxos) {
			if (err && err instanceof self.node.errors.NoOutputs) {
				utxos = [];
			} else if (err) {
				return self.common.handleErrors(err, res);
			}

			var totalBN = BigNumber(0);
			var remainBN = BigNumber(0);
			var suggest_utxos = [];
			utxos.forEach(function (tx) {
				tx = self.AddressController.transformUtxo(tx);
				if (tx.confirmations > 0) {
					if (totalBN.isLessThan(utxoCapBN)) {
						suggest_utxos.push(tx);
						totalBN = totalBN.plus(tx.satoshis);
					} else {
						remainBN = totalBN.minus(utxoCapBN);
						// if output is maybe a dust then include more utxo
						if (remainBN.isGreaterThan(0) && remainBN.isLessThan(546)) {
							suggest_utxos.push(tx);
							totalBN = totalBN.plus(tx.satoshis);
						}
					}
				}
			});

			if (totalBN.isLessThan(utxoCapBN)) {
				return self.common.handleErrors({ message: "Not enough money", code: 1 }, res);
			}

			transaction = transaction
				.from(suggest_utxos)          // Feed information about what unspent outputs one can use
				.to(toAddresses)  // Add an output with the given amount of satoshis
				.change(fromAddrString);      // Sets up a change address where the rest of the funds will go

			// Check Serialize Transaction: if return error we will have to process more
			var serialize_opts = {
				disableSmallFees: false,
				disableLargeFees: false,
				disableIsFullySigned: true,
				disableMoreOutputThanInput: true
			}
			if (disableCheckDustOutputs == 1) {
				serialize_opts.disableDustOutputs = true;
			} else {
				serialize_opts.disableDustOutputs = false;
			}

			var warningMessage;
			var dustAction = null;

			var hasDustOutput = transaction._hasDustOutputs(serialize_opts);
			if (hasDustOutput) {
				// Remove dust input (changeInput)
				var changeOutput = transaction.getChangeOutput();
				var changeOutputIndex = transaction._changeIndex;
				if (changeOutput) {
					transaction.removeOutput(transaction._changeIndex);
				}
				var transactionNew = new bitcore.Transaction()
					.from(suggest_utxos)          // Feed information about what unspent outputs one can use

				if (customFeeBN.isGreaterThan(0)) {
					transactionNew = transactionNew.fee(customFeeBN.toNumber()); // Add customFee
				} else {
					transactionNew = transactionNew.feePerKb(_feePerKb);
					// transactionNew = transactionNew.fee(defaultWebWalletFee); // Add default customFee
				}
				// move dust output to transaction fee
				dustAction = 0;
				warningMessage = 'Dust Input (index:' + changeOutputIndex + ', value:' + changeOutput.satoshis + ' sat) was removed & included to tx-fee';

				transactionNew.to(toAddresses);  // Add an output with the given amount of satoshis

				transaction = transactionNew;
			}

			var feeError = transaction._hasFeeError(serialize_opts, transaction._getUnspentValue());
			if (feeError) {
				warningMessage += feeError;
			}

			var rawtx = transaction.serialize(true);
			var txid = transaction._getHash().toString('hex');
			var fee = transaction._getUnspentValue();

			res.jsonp({ status: 'success', data: { raw: rawtx, txid: txid, fee: fee, feePerKb: _feePerKb }, code: '200', message: '', dustAction: dustAction });
		});
	});
};


module.exports = WalletController;
