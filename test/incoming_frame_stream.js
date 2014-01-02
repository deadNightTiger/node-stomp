/*
 * Test stompit.IncomingFrameStream
 * Copyright (c) 2014 Graham Daws <graham.daws@gmail.com>
 * MIT licensed
 */
 
var IncomingFrameStream = require('../lib/incoming_frame_stream');
var BufferWritable      = require('../lib/util/buffer/writable');
var assert = require('assert');

describe('IncomingFrameStream', function(){
    
    var stream;
    
    beforeEach(function(){
        stream = new IncomingFrameStream();
    });
    
    describe('IncomingFrame', function(){
        
        var readFrame = function(stream, callback){
            
            var read = false;
            
            var onreadable = function(){
                if(!read){
                    var frame = stream.read();
                    if(frame !== null){
                        read = true;
                        stream.removeListener('readable', onreadable);
                        callback(null, frame);
                        
                    }
                }
            };
            
            stream.on('readable', onreadable);
            
            onreadable();
        };
        
        var readFrameBody = function(stream, callback){
            
            readFrame(stream, function(error, frame){
                
                if(error){
                    callback(error);
                    return;
                }
                
                var writable = new BufferWritable(new Buffer(20));
                
                writable.on('finish', function(){
                    callback(null, frame, writable.getWrittenSlice()); 
                });
                
                frame.pipe(writable);
            });
        };
        
        it('should read variable-length bodies', function(done){
            
            stream.write('CONNECT\n\nONE\x00\n\nCONNECT\n\nTWO\x00');
            
            readFrameBody(stream, function(error, frame, body){
                
                assert(!error);
                
                assert(body.length === 3);
                assert(body.toString() === 'ONE');
                
                readFrameBody(stream, function(error, frame, body){
                    
                    assert(!error);
                    assert(body.length === 3);
                    assert(body.toString() === 'TWO');
                    
                    done();
                });
            });
        });
        
        it('should read fixed-length bodies', function(done){
            
            stream.write('CONNECT\ncontent-length:4\n\n\x00\x00\x00\x00\x00CONNECT\ncontent-length:3\n\n\x00\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                
                assert(!error);
                assert(frame.headers['content-length'] === 4);
                assert(body[0] === 0 && body[1] === 0 && body[2] === 0 && body[3] === 0);
                
                readFrameBody(stream, function(error, frame, body){
                    
                    assert(!error);
                    assert(frame.headers['content-length'] === 3);
                    assert(body[0] === 0 && body[1] === 10 && body[2] === 10);
                    
                    done();
                });
            });
        });
        
        it('should read empty frame', function(done){
            
            stream.write('CONNECT\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                assert(!error);
                assert(body.length == 0);
                done();
            });
        });
        
        it('should decode v1.1 escaped characters', function(done){
            
            stream.setVersion('1.1');
            
            stream.write('CONNECT\nheader1:\\ctest\nheader2:test\\n\nheader3:\\c\\n\\\\\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                
                assert(frame.headers['header1'] === ':test');
                assert(frame.headers['header2'] === 'test\n');
                assert(frame.headers['header3'] === ':\n\\');
                
                assert(body.length === 0);
                
                done();
            });
        });
        
        it('should decode v1.2 escaped characters', function(done){
            
            stream.setVersion('1.2');
            
            stream.write('CONNECT\nheader1:\\r\\n\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                assert(frame.headers['header1'] === '\r\n');
                done();
            });
        });
        
        it('should not decode any escape characters in version 1.0', function(done){
           
            stream.setVersion('1.0');
            
            stream.write('CONNECT\nheader1:\\ctest\\n:\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                assert(frame.headers['header1'] === '\\ctest\\n:');
                done();
            });
        });
        
        it('should parse header line with multiple colons', function(done){
            
            stream.write('CONNECT\nheader1::value:::value:\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                assert(frame.headers['header1'] === ':value:::value:');
                done(); 
            });
        });
        
        it('should emit an error for an undefined escape sequence', function(done){
            
            stream.setVersion('1.1');
            
            var processedStreamError = false;
            
            stream.on('error', function(error){
                assert(error);
                processedStreamError = true;
                done();
            });
            
            stream.write('CONNECT\nheader:\\rtest\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                assert(error);
            });
        });
        
        it('should use the first occuring entry of a repeated header', function(done){
            
            stream.write('CONNECT\ntest:1\ntest:2\n\n\x00');
            
            readFrameBody(stream, function(error, frame, body){
                assert(frame.headers['test'] === '1');
                done();
            });
        });
        
        
        it('should parse CRLF as EOL', function(done){
            
            stream.write('CONNECT\r\nheader1:value1\r\n\r\n\x00\r\n\r\nTEST\n\n\x00');
            
            readFrame(stream, function(error, frame){
                
                assert(frame.command === 'CONNECT');
                assert(frame.headers['header1'] === 'value1');
                
                frame.readEmptyBody(function(isEmpty){
                    assert(isEmpty);
                    readFrame(stream, function(error, frame){
                        frame.readEmptyBody(function(isEmpty){
                            assert(isEmpty);
                            done(); 
                        });
                    });

                });
            });
        });
        
        describe('#readEmptyBody', function(){
            
            it('should read an empty body', function(done){
                
                stream.write('CONNECT\n\n\x00');
                
                readFrame(stream, function(error, frame){
                    frame.readEmptyBody(function(isEmpty){
                        assert(isEmpty);
                        done();
                    });
                });
            });
            
            it('should not read a non-empty body', function(done){
                
                stream.write('CONNECT\n\nBODY\x00');
                
                readFrame(stream, function(error, frame){
                    frame.readEmptyBody(function(isEmpty){
                        assert(!isEmpty);
                        done();
                    });
                });
            });
        });
        
        describe('#read', function(){
            
            it('should not emit error event for a valid frame', function(done){
                
                stream.on('error', function(){
                    assert(false); 
                });
                
                stream.write('CONNECT\r\n\r\nBODY\x00');
                
                readFrameBody(stream, function(error, frame, body){
                    done();
                });
            });
        });
        
        describe('#readString', function(){
            
            it('should read all data into a string', function(done){
                
                stream.write('CONNECT\n\nBODY\x00');
                
                readFrame(stream, function(error, frame){
                    frame.readString('utf-8', function(error, body){
                        assert(!error);
                        assert(body === 'BODY');
                        done();
                    });
                });
            });
        });
    });
});