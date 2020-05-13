const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const next = require('next');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path')
const url = require('url');
var request = require('request-promise');
const fs = require('fs');
const envfile = require('envfile');
const formidable = require('formidable');
const multer = require('multer');
const Jimp = require('jimp');

// const auth = require('./routes/auth');
// const background = require('./routes/background');
// const drop = require('./routes/drop');

const mongoose = require('mongoose');
const config = require('./DB');
const Background = require('./models/Background');
const Drop = require('./models/Drop');
const Final = require('./models/Final');

mongoose.Promise = global.Promise;
mongoose.connect(config.DB, { useNewUrlParser: true, useCreateIndex: true }).then(
  () => {console.log('Database is connected') },
  err => { console.log('Can not connect to the database'+ err)}
);

var Storage = multer.diskStorage({
  destination: function(req, file, callback) {
      callback(null, "./public/upload");
  },
  filename: function(req, file, callback) {
      callback(null, file.fieldname + "_tmp" + path.extname(file.originalname));
      // callback(null, file.originalname);
  }
});
var upload = multer({ storage: Storage })

var DropStorage = multer.diskStorage({
  destination: function(req, file, callback) {
      callback(null, "./public/drop");
  },
  filename: function(req, file, callback) {
      callback(null, file.fieldname + "_tmp" + path.extname(file.originalname));
      // callback(null, file.originalname);
  }
});
var dropupload = multer({ storage: DropStorage })

const sourcePath = '.env';
console.log(envfile.parseFileSync(sourcePath))
const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

let { 
  SHOPIFY_API_SECRET_KEY, 
  SHOPIFY_API_KEY,
  ACCESSTOKEN,
  SCOPE,
  SHOP, 
  HOST 
} = process.env;

let draftImage = {};

app.prepare().then(() => {
  const server = express()
  server.use(cookieParser());
  server.use(cors());
  server.use(bodyParser.json());
  server.use(bodyParser.urlencoded({extended: true}));
  server.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
  });

  // server.use('/', auth);
  // server.use('/background', background);
  // server.use('/drop', drop);

  server.get('/shopify', function (req, res, next) {
    let shop = req.query.shop;
    let host = req.headers.host;
    //env file update -- add shop name and host name
    let parsedFile = envfile.parseFileSync(sourcePath);
    parsedFile.SHOP = shop;
    parsedFile.HOST = host;
    fs.writeFileSync('./.env', envfile.stringifySync(parsedFile))
    SHOP = shop;
    HOST = host;
    console.log('Shop=' + process.env.SHOP)
    //build the url
    let installUrl = `https://${SHOP}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPE}&redirect_uri=https://${HOST}/shopify/auth`;
    res.redirect(installUrl);
  });

  server.get('/shopify/auth', function (req, res, next) {
    let code = req.query.code;
    //Exchange temporary code for a permanent access token
    let accessTokenRequestUrl = 'https://' + SHOP + '/admin/oauth/access_token';
    let accessTokenPayload = {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET_KEY,
        code,
    };

    request.post(accessTokenRequestUrl, { json: accessTokenPayload })
      .then((accessTokenResponse) => {
          let accessToken = accessTokenResponse.access_token;
          let parsedFile = envfile.parseFileSync(sourcePath);
          parsedFile.ACCESSTOKEN = accessToken;
          fs.writeFileSync('./.env', envfile.stringifySync(parsedFile))
          ACCESSTOKEN = accessToken;
          console.log('shop token ' + accessToken);
          res.redirect('/');
      })
      .catch((error) => {
          res.status(error.statusCode).send(error.error.error_description);
      });
  });

  //Background Image Handel Part
  server.get('/background', function(req,res){
    Background.find()
      .then((doc)=>{
        res.json(doc);
      })
      .catch((err)=>{
        console.log(err);
      });
  });

  server.post('/background', upload.single('file'), async function (req, res, next) {
    let fileName = req.body.filename;
    let category = req.body.category;
    let changeName= 'blend_app_' + fileName.replace(/ /g, '_') + path.extname(req.file.filename);
    let themeID = '';
    let imageUrl = '';

    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    //Insert image to assets folder
    let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
    let new_image = {
      'asset': {
        'key': 'assets/' + changeName,
        'src': 'https://' + HOST + '/upload/' + req.file.filename
      }
    }
    let putImageOptions = {
        method: 'PUT',
        uri: putImageUrl,
        json: true,
        resolveWithFullResponse: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        },
        body: new_image
    };
    await request.put(putImageOptions)
      .then(function (response) {
        if (response.statusCode == 200) {
          imageUrl = response.body.asset.public_url;
        } else {
          res.send('fail to upload');
        }
      })
      .catch(function (err) {
          res.json(false);
      });

    // Insert Image data to MongoDB
    let background = new Background({ filename: fileName, keyname: changeName, filepath: imageUrl, category: category });
    Background.find({"filename": fileName})
      .then((doc)=>{
        if(doc.length == 0){
          background.save()
          .then(Background => {
            res.send("success");
          })
          .catch(err => {
            res.json(err);
          });
        } else {
          res.send('Image name upload');
        }
      })
      .catch((err)=>{
        res.json(err);
      });

  });

  server.post('/background/editWithFile', upload.single('file'), async function (req, res, next) {
    let id = req.body.id;
    let fileName = req.body.filename;
    let category = req.body.category;
    let changeName= 'blend_app_' + fileName.replace(/ /g, '_') + path.extname(req.file.filename);
    let themeID = '';
    let imageUrl = '';
    let editName = "";

    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
      })
      .catch(function (err) {
          res.json(err);
      });

    await Background.find({"_id": id})
    .then((doc)=>{
      editName = doc[0].keyname;
    })
    .catch((err)=>{
      res.json(err);
    });


    let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + editName;
    let deleteImageOptions = {
        method: 'DELETE',
        uri: deleteImageUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(deleteImageOptions)
      .then(function (response) {
          console.log("success deleted!");            
      })
      .catch(function (err) {
          res.json(err);
      });

    //Insert image to assets folder
    let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
    let new_image = {
      'asset': {
        'key': 'assets/' + changeName,
        'src': 'https://' + HOST + '/upload/' + req.file.filename
      }
    }
    let putImageOptions = {
        method: 'PUT',
        uri: putImageUrl,
        json: true,
        resolveWithFullResponse: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        },
        body: new_image
    };
    await request.put(putImageOptions)
      .then(function (response) {
        if (response.statusCode == 200) {
          imageUrl = response.body.asset.public_url;
        } else {
          res.send('fail to upload');
        }
      })
      .catch(function (err) {
          res.json(false);
      });

    await Background.update({_id: id}, { filename: fileName, keyname: changeName, filepath: imageUrl, category: category })
      .then((doc)=>{
        console.log("Image updated!");
        res.send("success");
      })
      .catch((err)=>{
        res.json(err);
      });
  });


  server.post('/background/editWithoutFile', async function (req, res, next) {
    let id = req.body.data.id;
    let fileName = req.body.data.filename;
    let category = req.body.data.category;
    console.log(id, fileName, category);
    let changeName= 'blend_app_' + fileName.replace(/ /g, '_');
    let themeID = '';
    let imageUrl = '';
    let editName = "";
    let editFilePath = "";

    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    await Background.find({"_id": id})
    .then((doc)=>{
      editName = doc[0].keyname;
      editFilePath = doc[0].filepath;
    })
    .catch((err)=>{
      res.json(err);
    });

    if(fileName == undefined) {
      Background.update({_id: id}, { category: category })
      .then((doc)=>{
        console.log("Image updated!");
        res.send("success");
      })
      .catch((err)=>{
        res.json(err);
      });
    } else {
      // Insert image to assets folder
      let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
      let new_image = {
        'asset': {
          'key': 'assets/' + changeName + path.extname(editName),
          'src': editFilePath
        }
      }
      let putImageOptions = {
          method: 'PUT',
          uri: putImageUrl,
          json: true,
          resolveWithFullResponse: true,
          headers: {
              'X-Shopify-Access-Token': ACCESSTOKEN,
              'content-type': 'application/json'
          },
          body: new_image
      };
      await request.put(putImageOptions)
        .then(function (response) {
          if (response.statusCode == 200) {
            imageUrl = response.body.asset.public_url;
          } else {
            res.send('fail to update');
          }
        })
        .catch(function (err) {
            res.json(false);
        });

      let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + editName;
      let deleteImageOptions = {
          method: 'DELETE',
          uri: deleteImageUrl,
          json: true,
          headers: {
              'X-Shopify-Access-Token': ACCESSTOKEN,
              'content-type': 'application/json'
          }
      };
      await request(deleteImageOptions)
        .then(function (response) {
            console.log("success deleted!");            
        })
        .catch(function (err) {
            res.json(err);
        });

      await Background.update({_id: id}, { filename: fileName, keyname: changeName + path.extname(editName), filepath: imageUrl, category: category })
        .then((doc)=>{
          console.log("Image updated!");
          res.send("success");
        })
        .catch((err)=>{
          res.json(err);
        });
    }
  });

  server.get('/background/deleteImage', async function(req,res){
    let id = req.query.id;
    let themeID = '';
    console.log(id)
    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    await Background.find({"_id": id})
      .then((doc)=>{
        editName = doc[0].keyname;
        Background.remove({"_id": id})
        .then((doc) => {
          console.log(doc);
          console.log("deleted from DB")
        })
        .catch((err)=>{
          res.json(err)
        })
      })
      .catch((err)=>{
        res.json(err);
      });

    let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + editName;
    let deleteImageOptions = {
        method: 'DELETE',
        uri: deleteImageUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(deleteImageOptions)
      .then(function (response) {
          res.send("success");            
      })
      .catch(function (err) {
          res.json(err);
      });
  });

  //Drop Image Handel Part
  server.get('/drop', function(req,res){
    Drop.find()
      .then((doc)=>{
        res.json(doc);
      })
      .catch((err)=>{
        console.log(err);
      });
  });

  server.post('/drop', dropupload.single('file'), async function (req, res, next) {
    let {
      supplierName,
      oilName,
      oilType,
      functionalSub,
      aromaticSub,
      blendsWellWith,
      aromaticDescription,
      aromaType,
      classifications,
      note
    } = req.body;

    console.log(supplierName, oilName, oilType, functionalSub, aromaticSub, blendsWellWith, aromaticDescription, aromaType, classifications, note)
      // res.send('fail to upload');
    let changeOilName= 'blend_app_' + oilName.replace(/ /g, '_') + path.extname(req.file.filename);
    let themeID = '';
    let imageUrl = '';

    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    //Insert image to assets folder
    let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
    let new_image = {
      'asset': {
        'key': 'assets/' + changeOilName,
        'src': 'https://' + HOST + '/drop/' + req.file.filename
      }
    }
    let putImageOptions = {
        method: 'PUT',
        uri: putImageUrl,
        json: true,
        resolveWithFullResponse: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        },
        
        body: new_image
    };
    await request.put(putImageOptions)
      .then(function (response) {
        if (response.statusCode == 200) {
          imageUrl = response.body.asset.public_url;
        } else {
          res.send('fail to upload');
        }
      })
      .catch(function (err) {
          res.json(false);
      });

    // Insert Image data to MongoDB
    let drop = new Drop({ 
      oilName: oilName, 
      keyname: changeOilName, 
      filepath: imageUrl, 
      supplierName: supplierName,
      oilType: oilType,
      functionalSub: functionalSub,
      aromaticSub: aromaticSub,
      blendsWellWith: blendsWellWith,
      aromaticDescription: aromaticDescription,
      aromaType: aromaType,
      classifications: classifications,
      note: note,
    });
    Drop.find({"filename": oilName})
      .then((doc)=>{
        if(doc.length == 0){
          drop.save()
          .then(drop => {
            res.send("success");
          })
          .catch(err => {
            res.json(err);
          });
        } else {
          res.send('Image name upload');
        }
      })
      .catch((err)=>{
        res.json(err);
      });
  });

  server.post('/drop/editWithFile', dropupload.single('file'), async function (req, res, next) {
    let {
      supplierName,
      oilName,
      oilType,
      functionalSub,
      aromaticSub,
      blendsWellWith,
      aromaticDescription,
      aromaType,
      classifications,
      note,
      id
    } = req.body;

    console.log(supplierName, oilName, oilType, functionalSub, aromaticSub, blendsWellWith, aromaticDescription, aromaType, classifications, note, id)
      // res.send('fail to upload');
    let changeOilName= 'blend_app_' + oilName.replace(/ /g, '_') + path.extname(req.file.filename);
    let themeID = '';
    let imageUrl = '';
    let editName = "";

    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
      })
      .catch(function (err) {
          res.json(err);
      });

    await Drop.find({"_id": id})
    .then((doc)=>{
      editName = doc[0].keyname;
    })
    .catch((err)=>{
      res.json(err);
    });


    let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + editName;
    let deleteImageOptions = {
        method: 'DELETE',
        uri: deleteImageUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(deleteImageOptions)
      .then(function (response) {
          console.log("success deleted!");            
      })
      .catch(function (err) {
          res.json(err);
      });

    //Insert image to assets folder
    let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
    let new_image = {
      'asset': {
        'key': 'assets/' + changeOilName,
        'src': 'https://' + HOST + '/drop/' + req.file.filename
      }
    }
    let putImageOptions = {
        method: 'PUT',
        uri: putImageUrl,
        json: true,
        resolveWithFullResponse: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        },
        body: new_image
    };
    await request.put(putImageOptions)
      .then(function (response) {
        if (response.statusCode == 200) {
          imageUrl = response.body.asset.public_url;
        } else {
          res.send('fail to upload');
        }
      })
      .catch(function (err) {
          res.json(false);
      });

    await Drop.update({_id: id}, { 
      oilName: oilName, 
      keyname: changeOilName, 
      filepath: imageUrl, 
      supplierName: supplierName,
      oilType: oilType,
      functionalSub: functionalSub,
      aromaticSub: aromaticSub,
      blendsWellWith: blendsWellWith,
      aromaticDescription: aromaticDescription,
      aromaType: aromaType,
      classifications: classifications,
      note: note,
    })
      .then((doc)=>{
        console.log("Image updated!");
        res.send("success");
      })
      .catch((err)=>{
        res.json(err);
      });
  });


  server.post('/drop/editWithoutFile', async function (req, res, next) {
  

    let {
      supplierName,
      oilName,
      oilType,
      functionalSub,
      aromaticSub,
      blendsWellWith,
      aromaticDescription,
      aromaType,
      classifications,
      note,
      id
    } = req.body;
   
    let changeOilName= 'blend_app_' + oilName.replace(/ /g, '_');
    let themeID = '';
    let imageUrl = '';
    let editName = "";
    let editFilePath = "";

    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
          'X-Shopify-Access-Token': ACCESSTOKEN,
          'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    await Drop.find({"_id": id})
    .then((doc)=>{
      editName = doc[0].keyname;
      editFilePath = doc[0].filepath;
    })
    .catch((err)=>{
      res.json(err);
    });

    if(oilName == undefined) {
      Drop.update({_id: id}, {
        supplierName: supplierName,
        oilType: oilType,
        functionalSub: functionalSub,
        aromaticSub: aromaticSub,
        blendsWellWith: blendsWellWith,
        aromaticDescription: aromaticDescription,
        aromaType: aromaType,
        classifications: classifications,
        note: note,
      })
      .then((doc)=>{
        console.log("Data updated!");
        res.send("success");
      })
      .catch((err)=>{
        res.json(err);
      });
    } else {
      // Insert image to assets folder
      let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
      let new_image = {
        'asset': {
          'key': 'assets/' + changeOilName + path.extname(editName),
          'src': editFilePath
        }
      }
      let putImageOptions = {
          method: 'PUT',
          uri: putImageUrl,
          json: true,
          resolveWithFullResponse: true,
          headers: {
              'X-Shopify-Access-Token': ACCESSTOKEN,
              'content-type': 'application/json'
          },
          body: new_image
      };
      await request.put(putImageOptions)
        .then(function (response) {
          if (response.statusCode == 200) {
            imageUrl = response.body.asset.public_url;
          } else {
            res.send('fail to update');
          }
        })
        .catch(function (err) {
            res.json(false);
        });

      let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + editName;
      let deleteImageOptions = {
          method: 'DELETE',
          uri: deleteImageUrl,
          json: true,
          headers: {
              'X-Shopify-Access-Token': ACCESSTOKEN,
              'content-type': 'application/json'
          }
      };
      await request(deleteImageOptions)
        .then(function (response) {
            console.log("success deleted!");            
        })
        .catch(function (err) {
            res.json(err);
        });

      await Drop.update({_id: id}, { 
        oilName: oilName, 
        keyname: changeOilName + path.extname(editName), 
        filepath: imageUrl,  
        supplierName: supplierName,
        oilType: oilType,
        functionalSub: functionalSub,
        aromaticSub: aromaticSub,
        blendsWellWith: blendsWellWith,
        aromaticDescription: aromaticDescription,
        aromaType: aromaType,
        classifications: classifications,
        note: note, 
      })
        .then((doc)=>{
          console.log("Image updated!");
          res.send("success");
        })
        .catch((err)=>{
          res.json(err);
        });
    }
  });

  server.get('/drop/deleteImage', async function(req,res){
    let id = req.query.id;
    let themeID = '';
    console.log(id)
    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    await Drop.find({"_id": id})
      .then((doc)=>{
        console.log(doc)
        editName = doc[0].keyname;
        Drop.remove({"_id": id})
        .then((doc) => {
          console.log(doc);
          console.log("deleted from DB")
        })
        .catch((err)=>{
          res.json(err)
        })
      })
      .catch((err)=>{
        res.json(err);
      });

    let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + editName;
    let deleteImageOptions = {
        method: 'DELETE',
        uri: deleteImageUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(deleteImageOptions)
      .then(function (response) {
          res.send("success");            
      })
      .catch(function (err) {
          res.json(err);
      });
  });

  server.post('/merger', async function(req, res){
    console.log(req.body.font)
    let arkana = await Jimp.loadFont("./public/font/arkana-script-rough.ttf.fnt");
    let BebasNeue = await Jimp.loadFont("./public/font/BebasNeue-Regular.ttf.fnt");
    let Lato = await Jimp.loadFont("./public/font/Lato-Regular.ttf.fnt");
    let Merriweather = await Jimp.loadFont("./public/font/Merriweather-Regular.ttf.fnt");
    let Montserrat = await Jimp.loadFont("./public/font/Montserrat-Regular.ttf.fnt");
    let OpenSans = await Jimp.loadFont("./public/font/OpenSans-Regular.ttf.fnt");
    let Poppins = await Jimp.loadFont("./public/font/Poppins-Regular.ttf.fnt");
    let Ubuntu = await Jimp.loadFont("./public/font/Ubuntu-Regular.ttf.fnt");

    let font = {};
    switch(req.body.font) {
      case "arkana":
        font = arkana;
        console.log("arkana")
        break;
      case "BebasNeue":
        font = BebasNeue;
        console.log("BebasNeue")
        break;
      case "Lato":
        font = Lato;
        console.log("Lato")
        break;
      case "Merriweather":
        font = Merriweather;
        console.log("Merriweather")
        break;
      case "Montserrat":
        font = Montserrat;
        console.log("Montserrat")
        break;
      case "BebasNeue":
        font = BebasNeue;
        console.log("BebasNeue")
        break;
      case "Poppins":
        font = Poppins;
        console.log("Poppins")
        break;
      case "Ubuntu":
        font = Ubuntu;
        console.log("Ubuntu")
        break;    
      default:
        font = OpenSans;
        console.log("default")
    }

    let images = [
      req.body.background,
      req.body.top_oil,
      req.body.middle_oil,
      req.body.bottom_oil,
      "https://cdn.shopify.com/s/files/1/0025/0799/7284/files/mark1.png?v=1587375289"
    ];

    let jimps = [];
    console.log(req.body.color)

    for(let i=0; i<images.length; i++){
      jimps.push(Jimp.read(images[i]));
    }
    await Promise.all(jimps).then(function(data){
      return Promise.all(jimps);
    }).then(function(data){

      data[0].resize( data[0].bitmap.width*2,  data[0].bitmap.height*2);
      data[1].resize( data[1].bitmap.width*2/3,  data[1].bitmap.height*2/3);
      data[2].resize( data[2].bitmap.width*2/3,  data[2].bitmap.height*2/3);
      data[3].resize( data[3].bitmap.width*2/3,  data[3].bitmap.height*2/3);
      data[4].resize(data[0].bitmap.width, data[4].bitmap.height)
      data[4].crop( ((data[4].bitmap.width - data[0].bitmap.width)/2), 0, data[0].bitmap.width, data[4].bitmap.height ); 
      let dropXPosition =  data[0].bitmap.width/2;
      let dropYPosition =  data[0].bitmap.height/3;
    
      let titleImage = new Jimp(Jimp.measureText(font, req.body.title), Jimp.measureTextHeight(font, req.body.title, 100));
      titleImage.print(font, 0, 0, req.body.title);
      titleImage.color([{ apply: 'xor', params: [req.body.color] }]);

      data[0].composite(titleImage, (data[0].bitmap.width/2 - Jimp.measureText(font, req.body.title)/2), (data[0].bitmap.height/6))
      
      
      for(let i = 0; i < req.body.topCount; i++) {
        data[0].composite(data[1], (dropXPosition - data[1].bitmap.width*i), dropYPosition)
      }
      let topOilName = new Jimp(Jimp.measureText(font, req.body.top_oilName), Jimp.measureTextHeight(font, req.body.top_oilName, 100));
      topOilName.print(font, 0, 0, req.body.top_oilName);
      topOilName.color([{ apply: 'xor', params: [req.body.color] }]);
      data[0].composite(topOilName, (dropXPosition + data[1].bitmap.width), dropYPosition)
     

      for(let i = 0; i < req.body.middleCount; i++) {
        data[0].composite(data[2], (dropXPosition - data[2].bitmap.width*i), (dropYPosition + data[1].bitmap.height + 10))
      }
      let middleOilName = new Jimp(Jimp.measureText(font, req.body.middle_oilName), Jimp.measureTextHeight(font, req.body.middle_oilName, 100));
      middleOilName.print(font, 0, 0, req.body.middle_oilName);
      middleOilName.color([{ apply: 'xor', params: [req.body.color] }]);
      data[0].composite(middleOilName, (dropXPosition + data[2].bitmap.width), (dropYPosition + data[1].bitmap.height + 10))
      
      
      for(let i = 0; i < req.body.bottomCount; i++) {
        data[0].composite(data[3], (dropXPosition - data[3].bitmap.width*i), (dropYPosition + data[1].bitmap.height + data[2].bitmap.height + 20))
      }
      let bottomOilName = new Jimp(Jimp.measureText(font, req.body.bottom_oilName), Jimp.measureTextHeight(font, req.body.bottom_oilName, 100));
      bottomOilName.print(font, 0, 0, req.body.bottom_oilName);
      bottomOilName.color([{ apply: 'xor', params: [req.body.color] }]);
      data[0].composite(bottomOilName, (dropXPosition + data[3].bitmap.width), (dropYPosition + data[1].bitmap.height + data[2].bitmap.height + 20))

      data[0].composite(data[4], 0, (data[0].bitmap.height - data[4].bitmap.height))      

      data[0].write('./public/write/test.png', function(){
        console.log("merged image!");
      })
    })


    let themeID = "";
    //Get Theme Id
    let getThemeIDUrl = 'https://' + SHOP + '/admin/api/2020-01/themes.json';
    let getThemeIDOptions = {
        method: 'GET',
        uri: getThemeIDUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(getThemeIDOptions)
      .then(function (parsedBody) {
          let theme = parsedBody.themes;
          theme.forEach(element => {
            if(element.role == 'main') {
              themeID = element.id;
              console.log("id:" +  themeID)
            }
          });
            
      })
      .catch(function (err) {
          res.json(err);
      });

    let keyname = Date.now() + "_" + Math.floor(Math.random() * 100);
    let deleteName = "";

    await Final.find({blendName: 'test'})
    .then((doc)=>{
      console.log(doc)
      deleteName = doc[0].keyname;
    })
    .catch(function (err) {
        res.json(false);
    });

    let deleteImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json?asset[key]=assets/' + deleteName;
    let deleteImageOptions = {
        method: 'DELETE',
        uri: deleteImageUrl,
        json: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        }
    };
    await request(deleteImageOptions)
      .then(function (response) {
          console.log("success deleted!");            
      })
      .catch(function (err) {
          res.json(err);
      });

    let imageUrl = "";
    //Insert image to assets folder
    let putImageUrl = 'https://' + SHOP + '/admin/api/2020-01/themes/'+ themeID +'/assets.json';
    let new_image = {
      'asset': {
        'key': 'assets/' + keyname + '.png',
        'src': 'https://' + HOST + '/write/test.png'
      }
    }
    console.log(new_image)
    let putImageOptions = {
        method: 'PUT',
        uri: putImageUrl,
        json: true,
        resolveWithFullResponse: true,
        headers: {
            'X-Shopify-Access-Token': ACCESSTOKEN,
            'content-type': 'application/json'
        },
        body: new_image
    };
    await request.put(putImageOptions)
      .then(function (response) {
        if (response.statusCode == 200) {
          imageUrl = response.body.asset.public_url;
          console.log("imageurl:" +  imageUrl)
        } else {
          console.log('fail to upload');
          res.send(false);
        }
      })
      .catch(function (err) {
        console.log(err)
          res.json(err);
      });

    //Insert Image data to MongoDB
    await Final.update({blendName: 'test'}, {
      keyname: keyname,
      filepath: imageUrl
    })
    .then((doc)=>{
      console.log("Data updated!");
      if(!res.headersSent) res.send(imageUrl);
    })
    .catch((err)=>{
      res.json(err);
    });
  });

  server.get('*', (req, res) => {
    return handle(req, res);
  })

  server.listen(port, () => {
    console.log("App listening on port 3000")
  })
}).catch((ex) => {
  console.error(ex.stack)
  process.exit(1)
});
