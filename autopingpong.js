var request = require("request");

var optionsPing = { method: 'POST',
  url: 'https://explorer.flashcoin.io/api/wallet/sendtx',
  headers:
   { 'postman-token': 'ab03d05a-13e7-2fbe-3e9f-5d058d6503de',
     'cache-control': 'no-cache',
     'content-type': 'application/x-www-form-urlencoded' },
  form:
   { to_public_address: 'UgQ7fCe7kkripmoubydu8F8Hv1NBhneGmv',
     amount: '2',
     from_public_address:'UW8ydV9KciXbUArAEgnNre5zK7U1yRXqFU',
     private_key:'' } };

function autoPing(){
  request(optionsPing, function (error, response, body) {
    if (error) throw new Error(error);
    console.log(body);
  });
  setTimeout(autoPing, 120000);
}

autoPing();

var optionsPong = { method: 'POST',
  url: 'https://explorer.flashcoin.io/api/wallet/sendtx',
  headers:
   { 'postman-token': 'ab03d05a-13e7-2fbe-3e9f-5d058d6503de',
     'cache-control': 'no-cache',
     'content-type': 'application/x-www-form-urlencoded' },
  form:
   { to_public_address: 'UW8ydV9KciXbUArAEgnNre5zK7U1yRXqFU',
     amount: '3',
     from_public_address:'UgQ7fCe7kkripmoubydu8F8Hv1NBhneGmv',
     private_key:'' } };

function autoPong(){
  request(optionsPong, function (error, response, body) {
    if (error) { console.log('error',error); throw new Error(error);}
    console.log(body);
  });
  setTimeout(autoPong, 180000);
}

autoPong();
