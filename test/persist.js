var sesame = require('sesame');
var Supermarket = require('supermarket');
var chaos = require('chaos');
var nStore = require('nStore');

var Seq = require('seq');
var uuid = require('uuid-pure').newId;

var fs = require('fs');
var connect = require('connect');
var http = require('http');

var assert = require('assert');

exports.supermarket = function () {
    var filename = '/tmp/sesame.supermarket.' + uuid(64) + '.db';
    var store = new Supermarket({ filename : filename, json : true });
    testStore(store);
    
    process.on('exit', function () {
        fs.unlinkSync(filename);
    });
};

exports.nStore = function () {
    var filename = '/tmp/sesame.nStore.' + uuid(64) + '.db';
    var store = nStore(filename);
    testStore(store);
    
    process.on('exit', function () {
        fs.unlinkSync(filename);
    });
};

exports.chaos = function () {
    var filename = '/tmp/sesame.chaos.' + uuid(64) + '.db';
    var store = chaos(filename).mount('sessions')
    testStore(store);
    
    process.on('exit', function () {
        fs.unlinkSync(filename);
    });
};

function testStore (store) {
    var port = 10000 + Math.floor(Math.random() * (65536 - 10000));
    
    var web1 = server(store);
    web1.listen(port);
    
    var web2;
    
    var to = setTimeout(function () {
        assert.fail('never finished');
    }, 5000);
    
    function whoami (id, cb) {
        var opts = {
            port : port,
            path : '/whoami',
            headers : { Cookie : 'session_id=' + id },
        };
        
        http.get(opts, function (res) {
            assert.ok(!res.headers['set-cookie']);
            res.on('data', function (body) {
                cb(body.toString());
            });
        });
    }
    
    Seq()
        .seq(setTimeout, Seq, 100)
        .seq(function () {
            var next = this;
            http.get({ port : port, path : '/whoami' }, function (res) {
                var cookie = res.headers['set-cookie'][0];
                assert.ok(cookie);
                var id = cookie.match(/^session_id=(.+)/)[1];
                assert.ok(id);
                
                assert.eql(res.headers['content-type'], 'text/html');
                res.on('data', function (body) {
                    assert.eql(body.toString(), 'nobody');
                    next(null, id);
                });
            })
        })
        .seq(function (id) {
            whoami(id, (function (name) {
                assert.eql(name, 'nobody');
                this(null, id);
            }).bind(this));
        })
        .seq(function (id) {
            var next = this;
            var data = 'name=O_o\r\n';
            var opts = {
                method : 'POST',
                port : port,
                path : '/sign-in',
                headers : {
                    Cookie : 'session_id=' + id,
                    'Content-Length' : data.length,
                },
            };
            
            var req = http.request(opts, function (res) {
                assert.ok(!res.headers['set-cookie']);
                res.on('data', function (body) {
                    assert.eql(body.toString(), 'ok');
                    next(null, id);
                });
            });
            req.write(data);
            req.end();
        })
        .seq(function (id) {
            whoami(id, (function (name) {
                assert.eql(name, 'O_o');
                this(null, id);
            }).bind(this));
        })
        .seq(function (id) {
            web1.close();
            setTimeout(this.bind({}, null, id), 100);
        })
        .seq(function (id) {
            web2 = server(store);
            web2.listen(port);
            setTimeout(this.bind({}, null, id), 100);
        })
        .seq(function (id) {
            whoami(id, (function (name) {
                assert.eql(name, 'O_o');
                this(null, id);
            }).bind(this));
        })
        .seq(function (id) {
            var next = this;
            var opts = {
                port : port,
                path : '/sign-out',
                headers : { Cookie : 'session_id=' + id },
            };
            
            http.get(opts, function (res) {
                assert.ok(!res.headers['set-cookie']);
                assert.eql(res.headers['content-type'], 'text/html');
                res.on('data', function (body) {
                    assert.eql(body.toString(), 'ok');
                    next(null, id);
                });
            })
        })
        .seq(function (id) {
            whoami(id, (function (name) {
                assert.eql(name, 'nobody');
                this(null, id);
            }).bind(this));
        })
        .seq(function () {
            clearTimeout(to);
            web2.close();
        })
        .catch(assert.fail)
    ;
}

function server (store) {
    var webserver = connect.createServer();
    webserver.use(connect.bodyParser());
    webserver.use(sesame({ store : store }));
    
    webserver.use(connect.router(function (app) {
        app.get('/whoami', function (req, res) {
            res.writeHead(200, { 'Content-Type' : 'text/html' });
            res.end(req.session.name || 'nobody');
        });
        
        app.post('/sign-in', function (req, res) {
            req.on('data', function (body) {
                var name = body.toString().match(/name=(.+)/)[1];
                req.session = { name : name };
                res.writeHead(200, { 'Content-Type' : 'text/html' });
                res.end('ok');
            });
        });
        
        app.get('/sign-out', function (req, res) {
            req.session = {};
            res.writeHead(200, { 'Content-Type' : 'text/html' });
            res.end('ok');
        });
    }));
    
    return webserver;
}
