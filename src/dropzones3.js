/*
 *
 * More info at [www.dropzonejs.com](http://www.dropzonejs.com)
 *
 * Copyright (c) 2012, Matias Meno
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 */

(function() {
  var AmazonXHR, S3File, Emitter, DropzoneS3, camelize, contentLoaded, detectVerticalSquash, drawImageIOSFix, noop, without, extend, param, buildParams, getExtension,
    __slice = [].slice,
    __hasProp = {}.hasOwnProperty,
    __extends = function(child, parent) {
      for (var key in parent) {
        if (__hasProp.call(parent, key)) child[key] = parent[key];
      }

      function ctor() {
        this.constructor = child;
      }
      ctor.prototype = parent.prototype;
      child.prototype = new ctor();
      child.__super__ = parent.prototype;
      return child;
    };

  noop = function() {};

  extend = function() {
    var key, object, objects, target, val, _i, _len;
    target = arguments[0], objects = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
    for (_i = 0, _len = objects.length; _i < _len; _i++) {
      object = objects[_i];
      for (key in object) {
        if (object[key] && object[key].constructor && object[key].constructor === Object) {
          target[key] = target[key] || {};
          arguments.callee(target[key], object[key]);
        } else {
          target[key] = object[key];
        }
      }
    }
    return target;
  };

  // http://stackoverflow.com/questions/190852/how-can-i-get-file-extensions-with-javascript
  getExtension = function(filename, fallback) {
    var a = filename.split(".");
    if( a.length === 1 || ( a[0] === "" && a.length === 2 ) ) {
      return fallback;
    }
    return a.pop().toLowerCase();
  };

  AmazonXHR = (function(CryptoJS) {

    var uriencode = function(string) {
      var output = encodeURIComponent(string);
      output = output.replace(/[^A-Za-z0-9_.~\-%]+/g, escape);
      output = output.replace(/;/g, "%3B");

      // AWS percent-encodes some extra non-standard characters in a URI
      output = output.replace(/[*]/g, function(ch) {
        return '%' + ch.charCodeAt(0).toString(16).toUpperCase();
      });

      return output;
    };

    var get_sorted_keys = function(obj) {
      var keys = [];
      for (var key in obj) {
        if (obj.hasOwnProperty(key)) {
          keys.push(key);
        }
      }
      return keys.sort();
    };

    var iso8601 = function(date) {
      return [
        date.getUTCFullYear(),
        zfill(date.getUTCMonth() + 1, 2),
        zfill(date.getUTCDate(), 2),
        "T",
        zfill(date.getUTCHours(), 2),
        zfill(date.getUTCMinutes(), 2),
        zfill(date.getUTCSeconds(), 2),
        "Z"
      ].join("");
    };

    var zfill = function(str, num) {
      return ("00000000000" + str).substr(-num);
    };

    var region_string = function(region) {
      // given an AWS region, it either returns an empty string for US-based regions
      // or the region name preceded by a dash for non-US-based regions
      // see this for more details: http://docs.aws.amazon.com/AmazonS3/latest/dev/VirtualHosting.html
      if (region && region.slice(0, 2) !== 'us') {
        return '-' + region;
      }
      return '';
    };

    function AmazonXHR(settings) {
      this.settings = settings;
    }

    AmazonXHR.prototype.send = function(callback) {
      var self = this;
      self.request_date = new Date();

      self.headers = self.settings.headers;
      self.headers['host'] = self.settings.auth.bucket + ".s3" + region_string(self.settings.auth.region) + ".amazonaws.com";

      var date_string = [
        self.settings.auth.date.getUTCFullYear(),
        zfill(self.settings.auth.date.getUTCMonth() + 1, 2),
        zfill(self.settings.auth.date.getUTCDate(), 2)
      ].join('');

      self.settings.querystring['X-Amz-Date'] = uriencode(iso8601(self.request_date));
      self.settings.querystring["X-Amz-Algorithm"] = "AWS4-HMAC-SHA256";
      self.settings.querystring["X-Amz-Expires"] = 86400; // 1 day
      self.settings.querystring["X-Amz-Credential"] = uriencode([
        self.settings.auth.access_key,
        "/" + date_string + "/",
        self.settings.auth.region + "/s3/aws4_request"
      ].join(''));
      self.settings.querystring["X-Amz-SignedHeaders"] = "";

      var header_keys = [];
      for (var key in self.headers) {
        header_keys.push(key);
      }
      header_keys.sort();
      self.settings.querystring["X-Amz-SignedHeaders"] = uriencode(header_keys.join(';'));

      self.settings.querystring["X-Amz-Signature"] = self.get_authorization_header();

      var url = location.protocol + "//" + self.headers['host'] + "/" + self.settings.key;
      delete self.headers['host']; // keep this header only for hashing

      var first = true;
      for (var urlkey in self.settings.querystring) {
        if (self.settings.querystring.hasOwnProperty(urlkey)) {
          if (first) {
            url += "?";
          }
          first = false;
          url += urlkey + "=" + self.settings.querystring[urlkey] + "&";
        }
      }
      url = url.slice(0, -1); // remove extra ampersand

      var xhr = new XMLHttpRequest();
      xhr.timeout = self.settings.timeout || 0;
      xhr.addEventListener("load", self.settings.load_callback, true);
      xhr.addEventListener("readystatechange", self.settings.state_change_callback);
      xhr.addEventListener("error", self.settings.error_callback, true);
      xhr.upload.addEventListener('progress', self.settings.progress_callback);
      xhr.addEventListener('timeout', self.settings.timeout_callback);

      // default to GET
      self.settings.method = self.settings.method || "GET";

      xhr.open(self.settings.method, url, true);
      for (var header in self.headers) {
        xhr.setRequestHeader(header, self.headers[header]);
      }

      if (self.settings.payload) {
        xhr.send(self.settings.payload);
      } else {
        xhr.send();
      }
      if (callback) {
        callback(xhr);
      }
    };

    AmazonXHR.prototype.get_authorization_header = function() {
      if (!this.settings.auth.date) {
        throw "Invalid date given.";
      }

      var header = "";

      var header_keys = get_sorted_keys(this.headers);

      // signed headers
      var signed_headers = "";
      for (var i = 0; i < header_keys.length; i++) {
        signed_headers += header_keys[i].toLowerCase() + ";";
      }
      signed_headers = signed_headers.slice(0, -1);

      var canonical_request = this.get_canonical_request();
      var string_to_sign = this.get_string_to_sign(canonical_request, this.request_date);
      var signature = this.sign_request(string_to_sign);

      return signature;
    };

    AmazonXHR.prototype.get_canonical_request = function() {
      var request = "";

      // verb
      request += this.settings.method.toUpperCase() + "\n";

      // path
      request += "/" + uriencode(this.settings.key).replace(/%2F/g, "/") + "\n";

      // querystring
      var querystring_keys = get_sorted_keys(this.settings.querystring);
      var key, value, i;
      for (i = 0; i < querystring_keys.length; i++) {
        key = querystring_keys[i];
        value = this.settings.querystring[key];
        request += uriencode(key) + "=" + value + "&amp;";
      }
      request = request.slice(0, -"&amp;".length) + "\n"; // remove extra ampersand

      // headers
      var header_keys = get_sorted_keys(this.headers);
      for (i = 0; i < header_keys.length; i++) {
        key = header_keys[i];
        value = this.headers[key];
        request += key.toLowerCase() + ":" + value.trim() + "\n";
      }
      request += "\n";

      // signed headers
      for (i = 0; i < header_keys.length; i++) {
        request += header_keys[i].toLowerCase() + ";";
      }

      request = request.slice(0, -1) + "\n";
      request += "UNSIGNED-PAYLOAD";

      return request;
    };

    AmazonXHR.prototype.get_string_to_sign = function(canonical_request, time) {
      var to_sign = "";
      to_sign += "AWS4-HMAC-SHA256\n";
      to_sign += iso8601(time) + "\n";
      to_sign += [
        time.getUTCFullYear(),
        zfill(time.getUTCMonth() + 1, 2),
        zfill(time.getUTCDate(), 2),
        "/" + this.settings.auth.region + "/s3/aws4_request\n"
      ].join('');

      to_sign += CryptoJS.SHA256(canonical_request.replace(/&amp;/g, "&")).toString();

      return to_sign;
    };

    AmazonXHR.prototype.sign_request = function(string_to_sign) {
      if (!this.settings.auth.signature) {
        throw "No signature provided.";
      }

      var res = CryptoJS.HmacSHA256(
        string_to_sign,
        CryptoJS.enc.Hex.parse(this.settings.auth.signature)
      ).toString();
      return res;
    };

    return AmazonXHR;

  })(CryptoJS);

  AmazonXHR.init = function(auth, file, key, ssencrypt, load_callback, error_callback) {
    var request  = {
      auth: auth,
      key: key,
      method: "POST",
      querystring: {
        "uploads": ""
      },
      headers: {
        "x-amz-acl": auth.acl,
        "Content-Disposition": "attachment; filename=" + escape(file.name),
        "Content-Type": file.type || "application/octet-stream"
      },
      payload: "",
      load_callback: load_callback,
      error_callback: error_callback,
      timeout: 20000, // 20sec
      timeout_callback: error_callback
    };
    if (ssencrypt) {
      request.headers["x-amz-server-side-encryption"] = "AES256";
    }
    return new AmazonXHR(request).send();
  };

  AmazonXHR.list = function(auth, file, key, upload_id, chunk_size, callback, error_callback, marker) {
    var querystring = {
      "uploadId": upload_id
    };
    if (marker) {
      querystring['part-number-marker'] = marker;
    }
    return new AmazonXHR({
      auth: auth,
      key: key,
      method: "GET",
      querystring: querystring,
      headers: {},
      payload: "",
      error_callback: error_callback,
      load_callback: function(e) {
        if (e.target.status / 100 != 2) {
          return error_callback(e);
        }

        // process the parts, and return an array of
        // [part_number, etag, size] through the given callback
        // window.debug = e;
        var xml = e.target.responseXML;
        var parts = [];
        var xml_parts = xml.getElementsByTagName("Part");
        var num_chunks = Math.ceil(file.size / chunk_size);
        for (var i = 0; i < xml_parts.length; i++) {
          var part_number = parseInt(xml_parts[i].getElementsByTagName("PartNumber")[0].textContent, 10);
          var etag = xml_parts[i].getElementsByTagName("ETag")[0].textContent;
          var size = parseInt(xml_parts[i].getElementsByTagName("Size")[0].textContent, 10);

          if (part_number != num_chunks && size != chunk_size) {
            continue; // chunk corrupted
          } else if (part_number == num_chunks &&
            size != file.size % chunk_size) {
            continue; // final chunk corrupted
          }

          parts.push([
            part_number,
            etag,
            size
          ]);
        }
        var is_truncated = xml.getElementsByTagName("IsTruncated")[0].textContent;
        if (is_truncated === "true") {
          var part_marker = xml.getElementsByTagName("NextPartNumberMarker")[0].textContent;
          AmazonXHR.list(auth, key, upload_id, chunk_size, function(new_parts) {
              callback(parts.concat(new_parts));
            },
            error_callback,
            part_marker
          );
        } else {
          callback(parts);
        }
      },
      timeout: 20000, // 20sec
      timeout_callback: error_callback
    }).send();
  };

  AmazonXHR.uploadChunk = function(auth, key, upload_id, chunkNum, chunk, callbacks, xhr_callback) {
    var querystring = {
      partNumber: chunkNum + 1,
      uploadId: upload_id
    };
    return (new AmazonXHR({
      auth: auth,
      key: key,
      method: "PUT",
      querystring: querystring,
      headers: {},
      payload: chunk,
      load_callback: callbacks.load_callback,
      error_callback: callbacks.error_callback,
      progress_callback: callbacks.progress_callback
    })).send(xhr_callback);
  };

  AmazonXHR.finish = function(auth, file, key, upload_id, parts, chunk_size, load_callback, error_callback) {
    var querystring = {
      "uploadId": upload_id
    };

    // compose the CompleteMultipartUpload request for putting
    // the chunks together
    var data = "<CompleteMultipartUpload>";
    for (var i = 0; i < parts.length; i++) {
      data += "<Part>";
      data += "<PartNumber>" + parts[i][0] + "</PartNumber>";
      data += "<ETag>" + parts[i][1] + "</ETag>";
      data += "</Part>";
    }
    data += "</CompleteMultipartUpload>";

    // firefox requires a small hack
    if (navigator.userAgent.indexOf("Firefox") !== -1) {
      data = new Blob([data]);
    }

    return new AmazonXHR({
      auth: auth,
      key: key,
      method: "POST",
      querystring: querystring,
      headers: {},
      payload: data,
      load_callback: load_callback,
      error_callback: error_callback,
      timeout: 20000, // 20sec
      timeout_callback: error_callback
    }).send();
  };

  AmazonXHR.exists = function(auth, key, callback, error_callback) {
    return new AmazonXHR({
      auth: auth,
      key: key,
      method: "HEAD",
      querystring: {},
      headers: {},
      payload: "",
      load_callback: function(e) {
        return (e.target.status / 100 == 2) ? callback(true) : callback(false);
      },
      error_callback: error_callback,
      timeout: 20000, // 20sec
      timeout_callback: error_callback
    }).send();
  };

  AmazonXHR.abort = function(auth, key, uploadId, callback, error_callback) {
    return new AmazonXHR({
      auth: auth,
      key: key,
      method: "DELETE",
      querystring: {
        'uploadId': uploadId
      },
      headers: {},
      payload: "",
      load_callback: function(e) {
        return (e.target.status / 100 == 2) ? callback() : error_callback(e);
      },
      error_callback: error_callback,
      timeout: 20000, // 20sec
      timeout_callback: error_callback
    }).send();
  };


  S3File = (function(AmazonXHR) {

    function S3File(file, chunkSize) {
      this.file = file;
      this.totalBytes = 0;
      this.chunks = [];
      this.chunkSize = chunkSize || 1024 * 1024 * 5;
    }

    S3File.CHUNK_QUEUED = 'queued';

    S3File.CHUNK_UPLOADING = 'uploading';

    S3File.CHUNK_SUCCESS = 'success';

    // Rebuild all the chunk status information.
    var initChunkArray = function(fileSize, chunkSize) {
      var numChunks = Math.ceil(fileSize / chunkSize);
      chunks = new Array(numChunks);
      for (var i = 0; i < numChunks; i++) {
        chunks[i] = {
          'status': S3File.CHUNK_QUEUED,
          'bytesSent': 0,
          'progressDate': false
        };
      }
      return chunks;
    };
    // Rebuild our chunk info based on what we receive from Amazon
    var updateChunks = function(parts, fileSize, chunkSize) {
      var chunks = initChunkArray(fileSize, chunkSize);
      for (var i = 0; i < parts.length; i++) {
        var partNumber = parseInt(parts[i][0], 10);
        chunks[partNumber - 1].status = S3File.CHUNK_SUCCESS;
        chunks[partNumber - 1].bytesSent = chunkSize;
      }
      return chunks;
    };

    S3File.prototype.init = function(auth, key, ssencrypt, success_callback, error_callback) {
      var _this = this;
      this.auth = auth;
      this.auth.date = new Date(auth.date);
      this.key = key;

      if (!this.auth.uploadId) {
        // New file. Initiate a multipart upload with Amazon
        AmazonXHR.init(this.auth, this.file, this.key, ssencrypt, function(e) {
          if (e.target.status / 100 !== 2) {
            return error_callback(e);
          }
          var xml = e.target.responseXML;
          _this.auth.uploadId = xml.getElementsByTagName('UploadId')[0].textContent;
          _this.chunks = initChunkArray(_this.file.size, _this.chunkSize);
          success_callback(false);
        }, error_callback);
      } else {
        // UploadId was saved in backend. Get the uploaded parts from S3
        AmazonXHR.list(this.auth, this.file, this.key, this.auth.uploadId, this.chunkSize, function(parts) {
          // Got part list from Amazon
          _this.chunks = updateChunks(parts, _this.file.size, _this.chunkSize);
          // Process the queue
          success_callback(false);
        }, function(e) {
          if (e.target.status === 404 && e.target.responseText.indexOf("NoSuchUpload") !== -1) {
            // The specified multipart upload does not exist. The upload ID
            // might be invalid, or the multipart upload might have been aborted or completed.
            AmazonXHR.exists(_this.auth, _this.key, function(exists) {
              if (exists) {
                // set file to 100% complete
                _this.chunks = initChunkArray(_this.file.size, _this.chunkSize);
                for (var i = _this.chunks.length - 1; i >= 0; i--) {
                  _this.setChunkComplete(chunks[i]);
                }
                // Tell the callback that the file already exists
                success_callback(true);
              } else {
                // Process either not initiated or aborted so start from scratch.
                _this.auth.uploadId = null;
                _this.init(_this.auth, _this.key, ssencrypt, success_callback, error_callback);
              }
            }, function() {
              error_callback(e);
            });
          } else {
            error_callback(e);
          }
        });
      }
    };

    S3File.prototype.getNextQueuedChunk = function() {
      for (var i = 0, _l = this.chunks.length; i < _l; i++) {
        if (this.chunks[i].status === S3File.CHUNK_QUEUED) {
          return i;
        }
      }
      return false;
    };

    S3File.prototype.getUploadingChunks = function() {
      var _ret = [];
      for (var i = 0, _l = this.chunks.length; i < _l; i++) {
        if (this.chunks[i].status === S3File.CHUNK_UPLOADING) {
          _ret.push(i);
        }
      }
      return _ret ? _ret : false;
    };

    S3File.prototype.chunksSuccessful = function() {
      for (var i = 0, _l = this.chunks.length; i < _l; i++) {
        if (this.chunks[i].status !== S3File.CHUNK_SUCCESS) {
          return false;
        }
      }
      return true;
    };

    S3File.prototype.uploadChunk = function(chunkNum, success_callback, error_callback, progress_callback) {
      var _this = this,
        load_callback = function(e) {
          if (e.target.status / 100 == 2) {
            success_callback(e);
          } else {
            error_callback(e);
          }
        },
        callbacks = {
          "load_callback": load_callback,
          "error_callback": error_callback,
          "progress_callback": progress_callback
        },
        chunk = this.chunks[chunkNum],
        length = this.chunkSize,
        start = chunkNum * length,
        end = Math.min(start + length, this.file.size);
      chunk.status = S3File.CHUNK_UPLOADING;
      chunk.progressDate = new Date();
      AmazonXHR.uploadChunk(this.auth, this.key, this.auth.uploadId, chunkNum, this.file.slice(start, end), callbacks, function(xhr) {
        chunk.xhr = xhr;
        // the watcher interval; it cancels the xhr if it times out
        chunk.interval = setInterval((function(chunk) {
          if (chunk.progressDate && (new Date() - chunk.progressDate) > 15000) { // 15s
            clearInterval(chunk.interval);
            if (_this.getUploadingChunks()) {
              // Attempting to upload file, not canceled, paused or anything.
              chunk.xhr.abort();
              error_callback(chunk.xhr);
            }
          }
        })(chunk), 4000); // every 4s
      });
    };

    S3File.prototype.setChunkProgress = function(chunkNum, bytesSent) {
      this.chunks[chunkNum].bytesSent = bytesSent;
      this.totalBytes = 0;
      for (var i = this.chunks.length - 1; i >= 0; i--) {
        this.totalBytes += this.chunks[i].bytesSent;
      }
    };

    S3File.prototype.setChunkComplete = function(chunkNum) {
      var thisChunkSize = ((this.chunks.length - 1) == chunkNum) ? this.file.size % this.chunkSize : this.chunkSize;

      this.setChunkProgress(chunkNum, thisChunkSize);
      clearInterval(this.chunks[chunkNum].interval);
      this.chunks[chunkNum].status = S3File.CHUNK_SUCCESS;
    };

    S3File.prototype.resetChunk = function(chunkNum) {
      this.setChunkProgress(chunkNum, 0);
      clearInterval(this.chunks[chunkNum].interval);
      this.chunks[chunkNum].status = S3File.CHUNK_QUEUED;
    };

    S3File.prototype.getTotalProgress = function() {
      return this.totalBytes / this.file.size * 100;
    };

    S3File.prototype.getBytesSent = function() {
      return this.totalBytes;
    };

    S3File.prototype.reset = function() {
      this.totalProgress = 0;
      this.auth = null;
      this.chunks = [];
    };

    S3File.prototype.abort = function(success_callback, error_callback) {
      for (var i = this.chunks.length - 1; i >= 0; i--) {
        if (this.chunks[i].hasOwnProperty('xhr')) {
          this.chunks[i].xhr.abort();
        }
      }
      AmazonXHR.abort(this.auth, this.key, this.auth.uploadId, success_callback, error_callback);
      this.reset();
    };

    S3File.prototype.finishUpload = function(success_callback, parts_incomplete_callback, error_callback) {
      var _this = this;
      // Check that we uploaded all the chunks and upload any missing ones if we didnt.
      AmazonXHR.list(this.auth, this.file, this.key, this.auth.uploadId, this.chunkSize, function(parts) {
        if (parts.length != _this.chunks.length) {
          // Amazon does not have all the parts
          _this.chunks = updateChunks(parts, _this.file.size, _this.chunkSize);
          parts_incomplete_callback();
        } else {
          AmazonXHR.finish(_this.auth, _this.file, _this.key, _this.auth.uploadId, parts, _this.chunkSize, function(e) {
            if (e.target.status / 100 == 2) {
              success_callback(e);
            } else if (e.target.status == 400 && e.target.responseText.indexOf("EntityTooSmall") !== -1) {
              // Recursive. Check again for missing parts and attempt to send.
              this.file.upload.finishUpload(success_callback, parts_incomplete_callback, error_callback);
            } else if (e.target.status === 404 && e.target.responseText.indexOf("NoSuchUpload") !== -1) {
              // The specified multipart upload does not exist. The upload ID
              // might be invalid, or the multipart upload might have been aborted or completed.
              AmazonXHR.exists(_this.auth, _this.key, function(exists) {
                return (exists ? success_callback(e) : error_callback(e));
              }, error_callback);
            } else {
              error_callback(e);
            }
          }, error_callback);
        }
      }, function(e) {
        // List request did not return parts
        if (e.target.status == 404 && e.target.responseText.indexOf("NoSuchUpload") !== -1) {
          AmazonXHR.exists(_this.auth, _this.key, function(exists) {
            return (exists ? success_callback(e) : error_callback(e));
          }, error_callback);
        } else {
          error_callback(e);
        }
      });
    };

    return S3File;

  })(AmazonXHR);


  Emitter = (function() {
    function Emitter() {}

    Emitter.prototype.addEventListener = Emitter.prototype.on;

    Emitter.prototype.on = function(event, fn) {
      this._callbacks = this._callbacks || {};
      if (!this._callbacks[event]) {
        this._callbacks[event] = [];
      }
      this._callbacks[event].push(fn);
      return this;
    };

    Emitter.prototype.emit = function() {
      var args, callback, callbacks, event, _i, _len;
      event = arguments[0], args = 2 <= arguments.length ? __slice.call(arguments, 1) : [];
      this._callbacks = this._callbacks || {};
      callbacks = this._callbacks[event];
      if (callbacks) {
        for (_i = 0, _len = callbacks.length; _i < _len; _i++) {
          callback = callbacks[_i];
          callback.apply(this, args);
        }
      }
      return this;
    };

    Emitter.prototype.removeListener = Emitter.prototype.off;

    Emitter.prototype.removeAllListeners = Emitter.prototype.off;

    Emitter.prototype.removeEventListener = Emitter.prototype.off;

    Emitter.prototype.off = function(event, fn) {
      var callback, callbacks, i, _i, _len;
      if (!this._callbacks || arguments.length === 0) {
        this._callbacks = {};
        return this;
      }
      callbacks = this._callbacks[event];
      if (!callbacks) {
        return this;
      }
      if (arguments.length === 1) {
        delete this._callbacks[event];
        return this;
      }
      for (i = _i = 0, _len = callbacks.length; _i < _len; i = ++_i) {
        callback = callbacks[i];
        if (callback === fn) {
          callbacks.splice(i, 1);
          break;
        }
      }
      return this;
    };

    return Emitter;

  })();


  DropzoneS3 = (function(_super) {

    __extends(DropzoneS3, _super);

    DropzoneS3.prototype.Emitter = Emitter;

    /*
    This is a list of all available events you can register on a dropzone object.

    You can register an event handler like this:

        dropzone.on("dragEnter", function() { });
     */

    DropzoneS3.prototype.events = [
      "drop",
      "dragstart",
      "dragend",
      "dragenter",
      "dragover",
      "dragleave",
      "duplicate",
      "addedfile",
      "removedfile",
      "thumbnail",
      "error",
      "sign",
      "filesigned",
      "fileinit",
      "enqueuing",
      "uploadprogress",
      "totaluploadprogress",
      "sending",
      "notify",
      "success",
      "canceled",
      "complete",
      "reset",
      "maxfilesexceeded",
      "maxfilesreached",
      "queuecomplete",
      "pause",
      "resume",
      "resumed"
    ];

    DropzoneS3.prototype.defaultOptions = {
      s3: {
        region: "us-east-1",
        bucket: null,
        accesskey: null,
        acl: "private",
        ssencrypt: false // Server side encrypt AES256
      },
      signing: {
        endpoint: '/dropzones3/sign/',
        params: {}
      },
      notifying: {
        notify: true, // Tell server about the file on S3.
        endpoint: '/dropzones3/finish/',
        params: {}
      },
      chunking: {
        maxConcurrentWorkers: 6,
        maxChunkSize: 1024 * 1024 * 5 // 5 MB
      },
      resuming: {
        automaticRetry: true,
        localStorageResume: true,
        localStoragePrefix: null, // Unique but consistent per instance to avoid collisions.
        retryAttempts: 0, // 0  = infinit retry attempts
        retryInterval: 10 // seconds
      },
      thumbnails: {
        createImageThumbnails: true,
        maxThumbnailFilesize: 10,
        thumbnailWidth: 120,
        thumbnailHeight: 120
      },
      validation: {
        maxFiles: null,
        maxFilesize: 1000 * 10, // 10 GB
        allowDuplicates: false,
        acceptedFiles: null,
      },
      paramName: "file",
      clickable: true,
      ignoreHiddenFiles: true,
      filesizeBase: 1000,
      autoQueue: true,
      addRemoveLinks: true,
      previewsContainer: null,
      capture: null,
      dictDefaultMessage: "Drop files here to upload",
      dictFallbackMessage: "Your browser does not support drag'n'drop file uploads.",
      dictFallbackText: "Please use the fallback form below to upload your files like in the olden days.",
      dictFileTooBig: "File is too big ({{filesize}}MiB). Max filesize: {{maxFilesize}}MiB.",
      dictInvalidFileType: "You can't upload files of this type.",
      dictResponseError: "Server responded with {{statusCode}} code.",
      dictConnectionError: "Connection error. Will retry upload in {{seconds}} seconds.",
      dictCancelUpload: "Cancel upload",
      dictResumeUpload: "Connection Error. Click to resume.",
      dictCancelUploadConfirmation: "Are you sure you want to cancel this upload?",
      dictRemoveFile: "Remove file",
      dictRemoveFileConfirmation: null,
      dictMaxFilesExceeded: "You can not upload any more files.",
      accept: function(file, done) {
        return done();
      },
      init: function() {
        return noop;
      },
      forceFallback: false,
      fallback: function() {
        var child, messageElement, span, _i, _len, _ref;
        this.element.className = "" + this.element.className + " dzs3-browser-not-supported";
        _ref = this.element.getElementsByTagName("div");
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          child = _ref[_i];
          if (/(^| )dzs3-message($| )/.test(child.className)) {
            messageElement = child;
            child.className = "dzs3-message";
            continue;
          }
        }
        if (!messageElement) {
          messageElement = DropzoneS3.createElement("<div class=\"dzs3-message\"><span></span></div>");
          this.element.appendChild(messageElement);
        }
        span = messageElement.getElementsByTagName("span")[0];
        if (span) {
          span.textContent = this.options.dictFallbackMessage;
        }
        return this.element.appendChild(this.getFallbackForm());
      },
      resize: function(file) {
        var info, srcRatio, trgRatio;
        info = {
          srcX: 0,
          srcY: 0,
          srcWidth: file.width,
          srcHeight: file.height
        };
        srcRatio = file.width / file.height;
        info.optWidth = this.options.thumbnails.thumbnailWidth;
        info.optHeight = this.options.thumbnails.thumbnailHeight;
        if ((info.optWidth == null) && (info.optHeight == null)) {
          info.optWidth = info.srcWidth;
          info.optHeight = info.srcHeight;
        } else if (info.optWidth == null) {
          info.optWidth = srcRatio * info.optHeight;
        } else if (info.optHeight == null) {
          info.optHeight = (1 / srcRatio) * info.optWidth;
        }
        trgRatio = info.optWidth / info.optHeight;
        if (file.height < info.optHeight || file.width < info.optWidth) {
          info.trgHeight = info.srcHeight;
          info.trgWidth = info.srcWidth;
        } else {
          if (srcRatio > trgRatio) {
            info.srcHeight = file.height;
            info.srcWidth = info.srcHeight * trgRatio;
          } else {
            info.srcWidth = file.width;
            info.srcHeight = info.srcWidth / trgRatio;
          }
        }
        info.srcX = (file.width - info.srcWidth) / 2;
        info.srcY = (file.height - info.srcHeight) / 2;
        return info;
      },

      /*
      Those functions register themselves to the events on init and handle all
      the user interface specific stuff. Overwriting them won't break the upload
      but can break the way it's displayed.
      You can overwrite them if you don't like the default behavior. If you just
      want to add an additional event handler, register it on the dropzone object
      and don't overwrite those options.
       */
      drop: function(e) {
        return this.element.classList.remove("dzs3-drag-hover");
      },
      dragstart: noop,
      dragend: function(e) {
        return this.element.classList.remove("dzs3-drag-hover");
      },
      dragenter: function(e) {
        return this.element.classList.add("dzs3-drag-hover");
      },
      dragover: function(e) {
        return this.element.classList.add("dzs3-drag-hover");
      },
      dragleave: function(e) {
        return this.element.classList.remove("dzs3-drag-hover");
      },
      paste: noop,
      reset: function() {
        return this.element.classList.remove("dzs3-started");
      },
      duplicate: function(existingFile, newFile) {
        if (existingFile.previewElement) {
          var handler = function(e, elapsedTime) {
            existingFile.previewElement.classList.remove("dzs3-duplicate-attempt");
            existingFile.previewElement.removeEventListener('transitionend', handler, true);
          };
          existingFile.previewElement.addEventListener('transitionend', handler, true);
          existingFile.previewElement.classList.add("dzs3-duplicate-attempt");
        }
      },
      addedfile: function(file) {
        var node, removeFileEvent, removeLink, _i, _j, _k, _len, _len1, _len2, _ref, _ref1, _ref2, _ref3, _results;
        if (this.element === this.previewsContainer) {
          this.element.classList.add("dzs3-started");
        }
        if (this.previewsContainer) {
          file.previewElement = DropzoneS3.createElement(this.options.previewTemplate.trim());
          file.previewTemplate = file.previewElement;
          this.previewsContainer.appendChild(file.previewElement);
          _ref = file.previewElement.querySelectorAll("[data-dzs3-name]");
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            node = _ref[_i];
            node.textContent = file.name;
          }
          _ref1 = file.previewElement.querySelectorAll("[data-dzs3-size]");
          for (_j = 0, _len1 = _ref1.length; _j < _len1; _j++) {
            node = _ref1[_j];
            node.innerHTML = this.filesize(file.size);
          }
          var fileExtension = getExtension(file.name, 'generic');
          _ref3 = file.previewElement.querySelectorAll("[data-dzs3-thumb-container]");
          for (_j = 0, _len1 = _ref3.length; _j < _len1; _j++) {
            _ref3[_j].classList.add('dzs3-ext-' + fileExtension);
          }

          if (this.options.addRemoveLinks) {
            file._removeLink = DropzoneS3.createElement("<a class=\"dzs3-remove\" href=\"javascript:undefined;\" data-dzs3-remove>" + this.options.dictRemoveFile + "</a>");
            file.previewElement.appendChild(file._removeLink);
          }
          removeFileEvent = (function(_this) {
            return function(e) {
              e.preventDefault();
              e.stopPropagation();
              if (file.status === DropzoneS3.UPLOADING) {
                return DropzoneS3.confirm(_this.options.dictCancelUploadConfirmation, function() {
                  return _this.removeFile(file);
                });
              } else {
                if (_this.options.dictRemoveFileConfirmation) {
                  return DropzoneS3.confirm(_this.options.dictRemoveFileConfirmation, function() {
                    return _this.removeFile(file);
                  });
                } else {
                  return _this.removeFile(file);
                }
              }
            };
          })(this);
          _ref2 = file.previewElement.querySelectorAll("[data-dzs3-remove]");
          _results = [];
          for (_k = 0, _len2 = _ref2.length; _k < _len2; _k++) {
            removeLink = _ref2[_k];
            _results.push(removeLink.addEventListener("click", removeFileEvent));
          }
          // return _results;
        }
      },
      removedfile: function(file) {
        var _ref;
        if (file.previewElement) {
          if ((_ref = file.previewElement) != null) {
            _ref.parentNode.removeChild(file.previewElement);
          }
        }
        return this._updateMaxFilesReachedClass();
      },
      thumbnail: function(file, dataUrl) {
        var thumbnailElement, _i, _len, _ref;
        if (file.previewElement) {
          file.previewElement.classList.remove("dzs3-file-preview");
          _ref = file.previewElement.querySelectorAll("[data-dzs3-thumbnail]");
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            thumbnailElement = _ref[_i];
            thumbnailElement.alt = file.name;
            thumbnailElement.src = dataUrl;
          }
          return setTimeout(((function(_this) {
            return function() {
              return file.previewElement.classList.add("dzs3-image-preview");
            };
          })(this)), 1);
        }
      },
      error: function(file, message) {
        var node, _i, _len, _ref, _results;
        if (file.previewElement) {
          file.previewElement.classList.add("dzs3-error");
          if (typeof message !== "String" && message.error) {
            message = message.error;
          }
          _ref = file.previewElement.querySelectorAll("[data-dzs3-errormessage]");
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            node = _ref[_i];
            _results.push(node.textContent = message);
          }
          return _results;
        }
      },
      sign: function(file) {
        if (file.previewElement) {
          file.previewElement.classList.add("dzs3-processing");
          if (file._removeLink) {
            file._removeLink.textContent = this.options.dictCancelUpload;
          }
        }
      },
      enqueuing: noop,
      filesigned: function(file, auth, done) {
        done();
      },
      fileinit: function(file, done) {
        done();
      },
      pause: function(file, message) {
        if (!this.options.resuming.automaticRetry) {
          return false;
        }
        var resumeFileEvent = (function(_this, file) {
          return function(e) {
            e.preventDefault();
            e.stopPropagation();
            file.previewElement.removeEventListener("click", resumeFileEvent);
            file.paused = false;
            _this.emit("resumed", file);
            _this.resumeFile(file);
          };
        })(this, file);

        file.previewElement.classList.add("dzs3-paused");
        file.previewElement.addEventListener("click", resumeFileEvent);

        if (!message) {
          message = '';
        }
        if (typeof message !== "String" && message.error) {
          message = message.error;
        }
        var _ref = file.previewElement.querySelectorAll("[data-dzs3-pausemessage]");
        for (var _i = 0, _len = _ref.length; _i < _len; _i++) {
          _ref[_i].textContent = message;
        }
      },
      resume: noop,
      resumed: function(file) {
        file.previewElement.classList.remove("dzs3-paused");
      },
      uploadprogress: function(file, progress, bytesSent) {
        var node, _i, _len, _ref, _results;
        if (file.previewElement) {
          _ref = file.previewElement.querySelectorAll("[data-dzs3-uploadprogress]");
          _results = [];
          for (_i = 0, _len = _ref.length; _i < _len; _i++) {
            node = _ref[_i];
            if (node.nodeName === 'PROGRESS') {
              _results.push(node.value = progress);
            } else {
              _results.push(node.style.width = "" + progress + "%");
            }
          }
          return _results;
        }
      },
      totaluploadprogress: noop,
      sending: noop,
      notify: function(file, done) {
        if (this.options.notifying.notify) {
          var _this = this, xhr = new XMLHttpRequest();

          file.status = DropzoneS3.NOTIFYING;

          xhr.onload = function() {
            if (xhr.status / 100 == 2) {
              try {
                var item = JSON.parse(xhr.responseText);
                file.fid = item.fid;
                done(file);
              } catch (ex) {
                _this._fatalError(file, ex.message);
              }
            } else if (xhr.status / 100 == 5) {
              // Hopefully a temporary server error
              return _this._recoverableError(file, xhr);
            } else {
              return _this._fatalError(file, _this.options.dictResponseError.replace("{{statusCode}}", xhr.status), xhr);
            }
          };
          xhr.onerror = xhr.ontimeout = function(e) {
            return _this._recoverableError(file, e.target);
          };
          xhr.timeout = 20000; // 20 seconds

          var params = {
            filename: file.name,
            filesize: file.size,
            filemime: file.type,
            key: file.upload.auth.key
          };
          extend(params, this.options.notifying.params);
          xhr.open("POST", this.options.notifying.endpoint, true);
          xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
          xhr.send(param(params));
        } else {
          done(file);
        }
      },
      success: function(file) {
        if (file.previewElement) {
          return file.previewElement.classList.add("dzs3-success");
        }
      },
      canceled: function(file) {
        return this.emit("error", file, "Upload canceled.");
      },
      complete: function(file) {
        if (file._removeLink) {
          file._removeLink.textContent = this.options.dictRemoveFile;
        }
        if (file.previewElement) {
          return file.previewElement.classList.add("dzs3-complete");
        }
      },
      maxfilesexceeded: noop,
      maxfilesreached: noop,
      queuecomplete: noop,
      previewTemplate: '<div class="dzs3-preview dzs3-file-preview">' +
        '<div class="dzs3-image dzs3-ext" data-dzs3-thumb-container><img data-dzs3-thumbnail /></div>' +
        '<div class="dzs3-details">' +
        '<div class="dzs3-size"><span data-dzs3-size></span></div>' +
        '<div class="dzs3-filename"><span data-dzs3-name></span></div>' +
        '</div>' +
        '<div class="dzs3-progress"><span class="dzs3-upload" data-dzs3-uploadprogress></span></div>' +
        '<div class="dzs3-error-message"><span data-dzs3-errormessage></span></div>' +
        '<div class="dzs3-pause-message"><span data-dzs3-pausemessage></span></div>' +
        '<div class="dzs3-success-mark">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54" version="1.1"><title>Check</title><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><path d="M23.5 31.8L17.6 25.9C16 24.4 13.5 24.4 11.9 25.9 10.4 27.5 10.4 30 11.9 31.6L20.4 40.1C20.5 40.2 20.6 40.3 20.7 40.3 22.3 41.9 24.8 41.9 26.3 40.3L43.3 23.3C44.9 21.8 44.9 19.2 43.3 17.7 41.8 16.1 39.2 16.1 37.7 17.7L23.5 31.8ZM27 53C41.4 53 53 41.4 53 27 53 12.6 41.4 1 27 1 12.6 1 1 12.6 1 27 1 41.4 12.6 53 27 53Z" stroke-opacity="0.2" stroke="#747474" fill-opacity="0.8" fill="#FFFFFF"/></g></svg>' +
        '</div>' +
        '<div class="dzs3-error-mark">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54" version="1.1"><title>Error</title><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g stroke="#747474" stroke-opacity="0.2" fill="#FFFFFF" fill-opacity="0.8"><path d="M32.7 29L38.3 23.3C39.9 21.8 39.9 19.2 38.3 17.7 36.8 16.1 34.2 16.1 32.7 17.7L27 23.3 21.3 17.7C19.8 16.1 17.2 16.1 15.7 17.7 14.1 19.2 14.1 21.8 15.7 23.3L21.3 29 15.7 34.7C14.1 36.2 14.1 38.8 15.7 40.3 17.2 41.9 19.8 41.9 21.3 40.3L27 34.7 32.7 40.3C34.2 41.9 36.8 41.9 38.3 40.3 39.9 38.8 39.9 36.2 38.3 34.7L32.7 29ZM27 53C41.4 53 53 41.4 53 27 53 12.6 41.4 1 27 1 12.6 1 1 12.6 1 27 1 41.4 12.6 53 27 53Z"/></g></g></svg>' +
        '</div>' +
        '<div class="dzs3-resume-mark">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="54" height="54" viewBox="0 0 54 54" version="1.1"><title>Continue</title><g stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><path d="M27 53C41.4 53 53 41.4 53 27 53 12.6 41.4 1 27 1 12.6 1 1 12.6 1 27 1 41.4 12.6 53 27 53ZM16.9 19.9L13.2 19.9 13.2 33.9 16.9 33.9 16.9 19.9 16.9 19.9ZM19.9 19.9L29.1 19.9 29 13.6C29 12 30 11.5 31.3 12.6L46.4 25.1C47.7 26.1 47.7 27.8 46.4 28.9L31.6 41.1C30.3 42.1 29.2 41.6 29.2 40L29.2 33.9 29.2 33.9 19.9 33.9 19.9 19.9 19.9 19.9ZM10.2 19.9L10 19.9C8.3 19.9 7 21.2 7 22.9L7 30.9C7 32.5 8.3 33.9 10 33.9L10.2 33.9 10.2 19.9Z" stroke-opacity="0.2" stroke="#747474" fill-opacity="0.8" fill="#FFFFFF"/></g></svg>' +
        '</div>' +
        '</div>'
    };

    function DropzoneS3(element, options) {
      var elementOptions, fallback, _ref;
      this.element = element;
      this.version = DropzoneS3.version;
      this.defaultOptions.previewTemplate = this.defaultOptions.previewTemplate.replace(/\n*/g, "");
      this.clickableElements = [];
      this.listeners = [];
      this.files = [];
      if (typeof this.element === "string") {
        this.element = document.querySelector(this.element);
      }
      if (!(this.element && (this.element.nodeType != null))) {
        throw new Error("Invalid dropzone element.");
      }
      if (this.element.dropzone) {
        throw new Error("DropzoneS3 already attached.");
      }
      DropzoneS3.instances.push(this);
      this.element.dropzone = this;
      elementOptions = (_ref = DropzoneS3.optionsForElement(this.element)) !== null ? _ref : {};
      this.options = extend({}, this.defaultOptions, elementOptions, options !== null ? options : {});
      if (!this.options.s3.bucket || !this.options.s3.accesskey) {
        throw new Error("Amazon S3 bucket and access key must be set.");
      }
      if (this.options.forceFallback || !DropzoneS3.isBrowserSupported()) {
        return this.options.fallback.call(this);
      }
      if (this.options.resuming.localStorageResume === true && this.options.resuming.localStoragePrefix == null) {
        this.options.resuming.localStoragePrefix = this.element.id || 'ds3';
      }
      if ((fallback = this.getExistingFallback()) && fallback.parentNode) {
        fallback.parentNode.removeChild(fallback);
      }
      if (this.options.previewsContainer !== false) {
        if (this.options.previewsContainer) {
          this.previewsContainer = DropzoneS3.getElement(this.options.previewsContainer, "previewsContainer");
        } else {
          this.previewsContainer = this.element;
        }
      }
      if (this.options.clickable) {
        if (this.options.clickable === true) {
          this.clickableElements = [this.element];
        } else {
          this.clickableElements = DropzoneS3.getElements(this.options.clickable, "clickable");
        }
      }
      this.init();
    };

    DropzoneS3.prototype.getAcceptedFiles = function() {
      var file, _i, _len, _ref, _results;
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (file.accepted) {
          _results.push(file);
        }
      }
      return _results;
    };

    DropzoneS3.prototype.getRejectedFiles = function() {
      var file, _i, _len, _ref, _results;
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (!file.accepted) {
          _results.push(file);
        }
      }
      return _results;
    };

    DropzoneS3.prototype.getFilesWithStatus = function(status) {
      var results = [];
      for (var i = 0, len = this.files.length; i < len; i++) {
        if (this.files[i].status === status) {
          results.push(this.files[i]);
        }
      }
      return results;
    };

    DropzoneS3.prototype.getQueuedFiles = function() {
      return this.getFilesWithStatus(DropzoneS3.QUEUED);
    };

    DropzoneS3.prototype.getUploadingFiles = function() {
      return this.getFilesWithStatus(DropzoneS3.UPLOADING);
    };

    DropzoneS3.prototype.getActiveFiles = function() {
      var results = [];
      for (var i = 0, len = this.files.length; i < len; i++) {
        if (this.files[i].status === DropzoneS3.UPLOADING || this.files[i].status === DropzoneS3.QUEUED) {
          results.push(this.files[i]);
        }
      }
      return results;
    };

    DropzoneS3.prototype.getWorkerCount = function() {
      var count = 0;
      for (var _l = 0, _len3 = this.files.length; _l < _len3; _l++) {
        count += this.files[_l].upload.getUploadingChunks().length;
      }
      return count;
    };

    DropzoneS3.prototype.init = function() {
      var eventName, noPropagation, setupHiddenFileInput, _i, _len, _ref, _ref1;
      if (this.element.tagName === "form") {
        this.element.setAttribute("enctype", "multipart/form-data");
      }
      if (this.element.classList.contains("dropzone") && !this.element.querySelector(".dzs3-message")) {
        this.element.appendChild(DropzoneS3.createElement("<div class=\"dzs3-default dzs3-message\"><span>" + this.options.dictDefaultMessage + "</span></div>"));
      }
      if (this.clickableElements.length) {
        setupHiddenFileInput = (function(_this) {
          return function() {
            if (_this.hiddenFileInput) {
              document.body.removeChild(_this.hiddenFileInput);
            }
            _this.hiddenFileInput = document.createElement("input");
            _this.hiddenFileInput.setAttribute("type", "file");
            if ((_this.options.validation.maxFiles === null) || _this.options.validation.maxFiles > 1) {
              _this.hiddenFileInput.setAttribute("multiple", "multiple");
            }
            _this.hiddenFileInput.className = "dzs3-hidden-input";
            if (_this.options.validation.acceptedFiles !== null) {
              _this.hiddenFileInput.setAttribute("accept", _this.options.validation.acceptedFiles);
            }
            if (_this.options.capture !== null) {
              _this.hiddenFileInput.setAttribute("capture", _this.options.capture);
            }
            _this.hiddenFileInput.style.visibility = "hidden";
            _this.hiddenFileInput.style.position = "absolute";
            _this.hiddenFileInput.style.top = "0";
            _this.hiddenFileInput.style.left = "0";
            _this.hiddenFileInput.style.height = "0";
            _this.hiddenFileInput.style.width = "0";
            document.body.appendChild(_this.hiddenFileInput);
            return _this.hiddenFileInput.addEventListener("change", function() {
              var file, files, _i, _len;
              files = _this.hiddenFileInput.files;
              if (files.length) {
                for (_i = 0, _len = files.length; _i < _len; _i++) {
                  file = files[_i];
                  _this.addFile(file);
                }
              }
              return setupHiddenFileInput();
            });
          };
        })(this);
        setupHiddenFileInput();
      }
      this.URL = (_ref = window.URL) !== null ? _ref : window.webkitURL;
      _ref1 = this.events;
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        eventName = _ref1[_i];
        this.on(eventName, this.options[eventName]);
      }
      this.on("uploadprogress", (function(_this) {
        return function() {
          return _this.updateTotalUploadProgress();
        };
      })(this));
      this.on("removedfile", (function(_this) {
        return function() {
          return _this.updateTotalUploadProgress();
        };
      })(this));
      this.on("canceled", (function(_this) {
        return function(file) {
          return _this.emit("complete", file);
        };
      })(this));
      this.on("complete", (function(_this) {
        return function(file) {
          if (_this.getUploadingFiles().length === 0 && _this.getQueuedFiles().length === 0) {
            return setTimeout((function() {
              return _this.emit("queuecomplete");
            }), 0);
          }
        };
      })(this));
      noPropagation = function(e) {
        e.stopPropagation();
        if (e.preventDefault) {
          return e.preventDefault();
        } else {
          return (e.returnValue = false);
        }
      };
      this.listeners = [{
        element: this.element,
        events: {
          "dragstart": (function(_this) {
            return function(e) {
              return _this.emit("dragstart", e);
            };
          })(this),
          "dragenter": (function(_this) {
            return function(e) {
              noPropagation(e);
              return _this.emit("dragenter", e);
            };
          })(this),
          "dragover": (function(_this) {
            return function(e) {
              var efct;
              try {
                efct = e.dataTransfer.effectAllowed;
              } catch (_error) {}
              e.dataTransfer.dropEffect = 'move' === efct || 'linkMove' === efct ? 'move' : 'copy';
              noPropagation(e);
              return _this.emit("dragover", e);
            };
          })(this),
          "dragleave": (function(_this) {
            return function(e) {
              return _this.emit("dragleave", e);
            };
          })(this),
          "drop": (function(_this) {
            return function(e) {
              noPropagation(e);
              return _this.drop(e);
            };
          })(this),
          "dragend": (function(_this) {
            return function(e) {
              return _this.emit("dragend", e);
            };
          })(this)
        }
      }];
      this.clickableElements.forEach((function(_this) {
        return function(clickableElement) {
          return _this.listeners.push({
            element: clickableElement,
            events: {
              "click": function(evt) {
                if ((clickableElement !== _this.element) || (evt.target === _this.element || DropzoneS3.elementInside(evt.target, _this.element.querySelector(".dzs3-message")))) {
                  return _this.hiddenFileInput.click();
                }
              }
            }
          });
        };
      })(this));
      this.enable();
      return this.options.init.call(this);
    };

    DropzoneS3.prototype.destroy = function() {
      var _ref;
      this.disable();
      this.removeAllFiles(true);
      if ((_ref = this.hiddenFileInput) != null ? _ref.parentNode : void 0) {
        this.hiddenFileInput.parentNode.removeChild(this.hiddenFileInput);
        this.hiddenFileInput = null;
      }
      delete this.element.dropzone;
      return DropzoneS3.instances.splice(DropzoneS3.instances.indexOf(this), 1);
    };

    DropzoneS3.prototype.updateTotalUploadProgress = function() {
      var activeFiles, file, totalBytes, totalBytesSent, totalUploadProgress, _i, _len, _ref;
      totalBytesSent = 0;
      totalBytes = 0;
      activeFiles = this.getActiveFiles();
      if (activeFiles.length) {
        _ref = this.getActiveFiles();
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          file = _ref[_i];
          totalBytesSent += file.upload.bytesSent;
          totalBytes += file.upload.total;
        }
        totalUploadProgress = 100 * totalBytesSent / totalBytes;
      } else {
        totalUploadProgress = 100;
      }
      return this.emit("totaluploadprogress", totalUploadProgress, totalBytes, totalBytesSent);
    };

    DropzoneS3.prototype._getParamName = function(n) {
      if (typeof this.options.paramName === "function") {
        return this.options.paramName(n);
      } else {
        return "" + this.options.paramName + (this.options.uploadMultiple ? "[" + n + "]" : "");
      }
    };

    // Not functioning correctly yet
    DropzoneS3.prototype.getFallbackForm = function() {
      var existingFallback, fields, fieldsString, form;
      if ((existingFallback = this.getExistingFallback())) {
        return existingFallback;
      }
      fieldsString = "<div class=\"dzs3-fallback\">";
      if (this.options.dictFallbackText) {
        fieldsString += "<p>" + this.options.dictFallbackText + "</p>";
      }
      fieldsString += "<input type=\"file\" name=\"" + (this._getParamName(0)) + "\" " + (this.options.uploadMultiple ? 'multiple="multiple"' : void 0) + " /><input type=\"submit\" value=\"Upload!\"></div>";
      fields = DropzoneS3.createElement(fieldsString);
      if (this.element.tagName !== "FORM") {
        form = DropzoneS3.createElement("<form action=\"" + 'AWS_URL_HERE' + "\" enctype=\"multipart/form-data\" method=\"POST\"></form>");
        form.appendChild(fields);
      } else {
        this.element.setAttribute("enctype", "multipart/form-data");
        this.element.setAttribute("method", this.options.method);
      }
      return form != null ? form : fields;
    };

    DropzoneS3.prototype.getExistingFallback = function() {
      var fallback, getFallback, tagName, _i, _len, _ref;
      getFallback = function(elements) {
        var el, _i, _len;
        for (_i = 0, _len = elements.length; _i < _len; _i++) {
          el = elements[_i];
          if (/(^| )fallback($| )/.test(el.className)) {
            return el;
          }
        }
      };
      _ref = ["div", "form"];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        tagName = _ref[_i];
        if ((fallback = getFallback(this.element.getElementsByTagName(tagName)))) {
          return fallback;
        }
      }
    };

    DropzoneS3.prototype.setupEventListeners = function() {
      var elementListeners, event, listener, _i, _len, _ref, _results;
      _ref = this.listeners;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        elementListeners = _ref[_i];
        _results.push((function() {
          var _ref1, _results1;
          _ref1 = elementListeners.events;
          _results1 = [];
          for (event in _ref1) {
            listener = _ref1[event];
            _results1.push(elementListeners.element.addEventListener(event, listener, false));
          }
          return _results1;
        })());
      }
      return _results;
    };

    DropzoneS3.prototype.removeEventListeners = function() {
      var elementListeners, event, listener, _i, _len, _ref, _results;
      _ref = this.listeners;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        elementListeners = _ref[_i];
        _results.push((function() {
          var _ref1, _results1;
          _ref1 = elementListeners.events;
          _results1 = [];
          for (event in _ref1) {
            listener = _ref1[event];
            _results1.push(elementListeners.element.removeEventListener(event, listener, false));
          }
          return _results1;
        })());
      }
      return _results;
    };

    DropzoneS3.prototype.disable = function() {
      var file, _i, _len, _ref, _results;
      this.clickableElements.forEach(function(element) {
        return element.classList.remove("dzs3-clickable");
      });
      this.removeEventListeners();
      _ref = this.files;
      _results = [];
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        _results.push(this.cancelUpload(file));
      }
      return _results;
    };

    DropzoneS3.prototype.enable = function() {
      this.clickableElements.forEach(function(element) {
        return element.classList.add("dzs3-clickable");
      });
      return this.setupEventListeners();
    };

    DropzoneS3.prototype.filesize = function(size) {
      var cutoff, i, selectedSize, selectedUnit, unit, units, _i, _len;
      units = ['TB', 'GB', 'MB', 'KB', 'b'];
      selectedSize = selectedUnit = null;
      for (i = _i = 0, _len = units.length; _i < _len; i = ++_i) {
        unit = units[i];
        cutoff = Math.pow(this.options.filesizeBase, 4 - i) / 10;
        if (size >= cutoff) {
          selectedSize = size / Math.pow(this.options.filesizeBase, 4 - i);
          selectedUnit = unit;
          break;
        }
      }
      selectedSize = Math.round(10 * selectedSize) / 10;
      return "<strong>" + selectedSize + "</strong> " + selectedUnit;
    };

    DropzoneS3.prototype._updateMaxFilesReachedClass = function() {
      if ((this.options.validation.maxFiles != null) && this.getAcceptedFiles().length >= this.options.validation.maxFiles) {
        if (this.getAcceptedFiles().length === this.options.validation.maxFiles) {
          this.emit('maxfilesreached', this.files);
        }
        return this.element.classList.add("dzs3-max-files-reached");
      } else {
        return this.element.classList.remove("dzs3-max-files-reached");
      }
    };

    DropzoneS3.prototype.drop = function(e) {
      var files, items;
      if (!e.dataTransfer) {
        return;
      }
      this.emit("drop", e);
      files = e.dataTransfer.files;
      if (files.length) {
        items = e.dataTransfer.items;
        if (items && items.length && (items[0].webkitGetAsEntry != null)) {
          this._addFilesFromItems(items);
        } else {
          this.handleFiles(files);
        }
      }
    };

    DropzoneS3.prototype.paste = function(e) {
      var items, _ref;
      if ((e != null ? (_ref = e.clipboardData) != null ? _ref.items : void 0 : void 0) == null) {
        return;
      }
      this.emit("paste", e);
      items = e.clipboardData.items;
      if (items.length) {
        return this._addFilesFromItems(items);
      }
    };

    DropzoneS3.prototype.handleFiles = function(files) {
      var file, _i, _len, _results;
      _results = [];
      for (_i = 0, _len = files.length; _i < _len; _i++) {
        file = files[_i];
        _results.push(this.addFile(file));
      }
      return _results;
    };

    DropzoneS3.prototype._addFilesFromItems = function(items) {
      var entry, item, _i, _len, _results;
      _results = [];
      for (_i = 0, _len = items.length; _i < _len; _i++) {
        item = items[_i];
        if ((item.webkitGetAsEntry != null) && (entry = item.webkitGetAsEntry())) {
          if (entry.isFile) {
            _results.push(this.addFile(item.getAsFile()));
          } else if (entry.isDirectory) {
            _results.push(this._addFilesFromDirectory(entry, entry.name));
          } else {
            _results.push(void 0);
          }
        } else if (item.getAsFile != null) {
          if ((item.kind === null) || item.kind === "file") {
            _results.push(this.addFile(item.getAsFile()));
          } else {
            _results.push(void 0);
          }
        } else {
          _results.push(void 0);
        }
      }
      return _results;
    };

    DropzoneS3.prototype._addFilesFromDirectory = function(directory, path) {
      var dirReader, entriesReader;
      dirReader = directory.createReader();
      entriesReader = (function(_this) {
        return function(entries) {
          var entry, _i, _len;
          for (_i = 0, _len = entries.length; _i < _len; _i++) {
            entry = entries[_i];
            if (entry.isFile) {
              entry.file(function(file) {
                if (_this.options.ignoreHiddenFiles && file.name.substring(0, 1) === '.') {
                  return;
                }
                file.fullPath = "" + path + "/" + file.name;
                return _this.addFile(file);
              });
            } else if (entry.isDirectory) {
              _this._addFilesFromDirectory(entry, "" + path + "/" + entry.name);
            }
          }
        };
      })(this);
      return dirReader.readEntries(entriesReader, function(error) {
        return typeof console !== "undefined" && console !== null ? typeof console.log === "function" ? console.log(error) : void 0 : void 0;
      });
    };

    DropzoneS3.prototype.addFile = function(file) {
      var _this = this;

      file.processed = false;
      file.isDuplicate = false;
      file.s3success = false;
      file.retryAttemptsRemaining = this.options.resuming.retryAttempts;

      if (this.options.validation.allowDuplicates === false && this.files.length) {
        for (var _i = 0, _len = this.files.length; _i < _len; _i++) {
          var _ref = this.files[_i];
          if (_ref && _ref.name === file.name && _ref.size === file.size && _ref.lastModified === file.lastModified) {
            // New file being added is probably a duplicate of an existing file.
            file.isDuplicate = true;
            switch (_ref.status) {
              case DropzoneS3.ERROR:
                // Remove the old file. Add the new one later.
                _this.removeFile(_ref);
                break;
              case DropzoneS3.PAUSED:
                // Attempt to resume original if file is duplicate and original is paused.
                _this.resumeFile(_ref);
              default:
                // Run if DropzoneS3.PAUSED as well as any other status.
                this.emit("duplicate", _ref, file);
                return;
            }
          }
        }
      }

      file.upload = new S3File(file, this.options.chunking.maxChunkSize);

      this.files.push(file);
      file.status = DropzoneS3.ADDED;
      this.emit("addedfile", file);
      this._enqueueThumbnail(file);
      return this.accept(file, (function(_this) {
        return function(error) {
          if (error) {
            file.accepted = false;
            _this._fatalError(file, error);
          } else {
            file.accepted = true;
            if (_this.options.autoQueue) {
              setTimeout(function() {
                return _this.enqueueFile(file);
              }, 0);
            }
          }
          return _this._updateMaxFilesReachedClass();
        };
      })(this));
    };

    DropzoneS3.prototype.accept = function(file, done) {
      var xhr, params;
      if (file.size > this.options.validation.maxFilesize * 1024 * 1024) {
        return done(this.options.dictFileTooBig.replace("{{filesize}}", Math.round(file.size / 1024 / 10.24) / 100).replace("{{maxFilesize}}", this.options.validation.maxFilesize));
      } else if (!DropzoneS3.isValidFile(file, this.options.validation.acceptedFiles)) {
        return done(this.options.dictInvalidFileType);
      } else if ((this.options.validation.maxFiles != null) && this.getAcceptedFiles().length >= this.options.validation.maxFiles) {
        done(this.options.dictMaxFilesExceeded.replace("{{maxFiles}}", this.options.validation.maxFiles));
        return this.emit("maxfilesexceeded", file);
      } else {
        return this.options.accept.call(this, file, done);
      }
    };

    DropzoneS3.prototype._thumbnailQueue = [];

    DropzoneS3.prototype._processingThumbnail = false;

    DropzoneS3.prototype._enqueueThumbnail = function(file) {
      if (this.options.thumbnails.createImageThumbnails && file.type.match(/image.*/) && file.size <= this.options.thumbnails.maxThumbnailFilesize * 1024 * 1024) {
        this._thumbnailQueue.push(file);
        return setTimeout(((function(_this) {
          return function() {
            return _this._processThumbnailQueue();
          };
        })(this)), 0);
      }
    };

    DropzoneS3.prototype._processThumbnailQueue = function() {
      if (this._processingThumbnail || this._thumbnailQueue.length === 0) {
        return;
      }
      this._processingThumbnail = true;
      return this.createThumbnail(this._thumbnailQueue.shift(), (function(_this) {
        return function() {
          _this._processingThumbnail = false;
          return _this._processThumbnailQueue();
        };
      })(this));
    };

    DropzoneS3.prototype.createThumbnail = function(file, callback) {
      var fileReader;
      fileReader = new FileReader;
      fileReader.onload = (function(_this) {
        return function() {
          if (file.type === "image/svg+xml") {
            _this.emit("thumbnail", file, fileReader.result);
            if (callback != null) {
              callback();
            }
            return;
          }
          return _this.createThumbnailFromUrl(file, fileReader.result, callback);
        };
      })(this);
      return fileReader.readAsDataURL(file);
    };

    DropzoneS3.prototype.createThumbnailFromUrl = function(file, imageUrl, callback) {
      var img;
      img = document.createElement("img");
      img.onload = (function(_this) {
        return function() {
          var canvas, ctx, resizeInfo, thumbnail, _ref, _ref1, _ref2, _ref3;
          file.width = img.width;
          file.height = img.height;
          resizeInfo = _this.options.resize.call(_this, file);
          if (resizeInfo.trgWidth == null) {
            resizeInfo.trgWidth = resizeInfo.optWidth;
          }
          if (resizeInfo.trgHeight == null) {
            resizeInfo.trgHeight = resizeInfo.optHeight;
          }
          canvas = document.createElement("canvas");
          ctx = canvas.getContext("2d");
          canvas.width = resizeInfo.trgWidth;
          canvas.height = resizeInfo.trgHeight;
          drawImageIOSFix(ctx, img, (_ref = resizeInfo.srcX) != null ? _ref : 0, (_ref1 = resizeInfo.srcY) != null ? _ref1 : 0, resizeInfo.srcWidth, resizeInfo.srcHeight, (_ref2 = resizeInfo.trgX) != null ? _ref2 : 0, (_ref3 = resizeInfo.trgY) != null ? _ref3 : 0, resizeInfo.trgWidth, resizeInfo.trgHeight);
          thumbnail = canvas.toDataURL("image/png");
          _this.emit("thumbnail", file, thumbnail);
          if (callback != null) {
            return callback();
          }
        };
      })(this);
      if (callback != null) {
        img.onerror = callback;
      }
      return (img.src = imageUrl);
    };

    DropzoneS3.prototype.enqueueFile = function(file) {
      var _this = this;
      if (file.status === DropzoneS3.ADDED && file.accepted === true) {
        this.emit("enqueuing", file);
        file.status = DropzoneS3.QUEUED;
        return setTimeout(function() {
          return _this.processQueue();
        }, 0);
      } else {
        throw new Error("This file can't be enqueued because it has not been processed or was rejected.");
      }
    };

    DropzoneS3.prototype.processQueue = function() {
      var _this = this, file, chunkNum,
        activeFiles = this.getActiveFiles(),
        workerCount = this.getWorkerCount();

      while ((file = activeFiles.shift()) && workerCount < this.options.chunking.maxConcurrentWorkers) {
        if (file.status == DropzoneS3.QUEUED && file.processed === false) {
          // Initiate the multipart upload
          this.sign(file);
          workerCount++;
        } else if (!file.s3success && file.upload.chunksSuccessful()) {
          // Tell amazon to complete the upload
          this.finishUpload(file);
          workerCount++;
        } else if (file.s3success && this.options.notifying.notify) {
          // Retry notifying the server of the successful upload to s3 if it failed previously.
          this.emit("notify", file, function(file) {
            _this._finished(file);
          });
        } else {
          // Start PUT requests uploading chunks
          while ((chunkNum = file.upload.getNextQueuedChunk()) !== false && workerCount < this.options.chunking.maxConcurrentWorkers) {
            this.uploadChunk(file, chunkNum);
            workerCount++;
          }
        }
      }
    };

    /*
    https://gist.github.com/dgs700/4677933
    Javascript object to URL encoded query string converter. Code extracted from
    jQuery.param() and boiled down to bare metal js. Should handle deep/nested
    objects and arrays in the same manner as jQuery's ajax functionality.
    */
    param = function(a) {
      var prefix, s, add, name, r20, output;
      s = [];
      r20 = /%20/g;
      add = function(key, value) {
        // If value is a function, invoke it and return its value
        value = (typeof value == 'function') ? value() : (value == null ? "" : value);
        s[s.length] = encodeURIComponent(key) + "=" + encodeURIComponent(value);
      };
      if (a instanceof Array) {
        for (name in a) {
          add(name, a[name]);
        }
      } else {
        for (prefix in a) {
          buildParams(prefix, a[prefix], add);
        }
      }
      output = s.join("&").replace(r20, "+");
      return output;
    };

    buildParams = function(prefix, obj, add) {
      var name, i, l, rbracket;
      rbracket = /\[\]$/;
      if (obj instanceof Array) {
        for (i = 0, l = obj.length; i < l; i++) {
          if (rbracket.test(prefix)) {
            add(prefix, obj[i]);
          } else {
            buildParams(prefix + "[" + (typeof obj[i] === "object" ? i : "") + "]", obj[i], add);
          }
        }
      } else if (typeof obj == "object") {
        // Serialize object item.
        for (name in obj) {
          buildParams(prefix + "[" + name + "]", obj[name], add);
        }
      } else {
        // Serialize scalar item.
        add(prefix, obj);
      }
    };

    DropzoneS3.prototype.sign = function(file) {
      var _this = this,
        params = {};

      if (file.processed === false && file.accepted === true) {
        // Get s3 signature from the backend.
        var xhr = new XMLHttpRequest();

        xhr.onload = function() {
          var auth = {};
          if (xhr.status / 100 == 2) {
            // Got signature, signature date, and key from server.
            try {
              auth = JSON.parse(xhr.responseText);
            } catch (ex) {
              return _this._fatalError(file, ex.message);
            }

            auth.region = _this.options.s3.region;
            auth.bucket = _this.options.s3.bucket;
            auth.access_key = _this.options.s3.accesskey;
            auth.acl = _this.options.s3.acl;

            // See if file has an uploadID from a previous upload attempt and try to resume.
            if (_this.options.resuming.localStorageResume === true && _this.options.validation.allowDuplicates === false) {
              var item;
              if ((item = window.localStorage.getItem(_this.options.resuming.localStoragePrefix + JSON.stringify({ "n": file.name, "s": file.size, "l": file.lastModified })))) {
                item = JSON.parse(item);
                auth.uploadId = item.u;
                auth.key = item.k;
              }
            }

            _this.emit("filesigned", file, auth, function() {
              // Initiate multipart upload with Amazon.
              file.upload.init(auth, auth.key, _this.options.s3.ssencrypt, function(status) {
                file.processed = true;
                if (status) {
                  _this._finished(file);
                } else {
                  // Save uploadId in case resume is needed.
                  if (_this.options.resuming.localStorageResume === true && _this.options.validation.allowDuplicates === false) {
                    window.localStorage.setItem(_this.options.resuming.localStoragePrefix + JSON.stringify({ "n": file.name, "s": file.size, "l": file.lastModified }), JSON.stringify({ "u": file.upload.auth.uploadId, "k": file.upload.auth.key }));
                  }
                  _this.emit("fileinit", file, function() {
                    file.status = DropzoneS3.QUEUED;
                    return setTimeout(function() {
                      return _this.processQueue();
                    }, 0);
                  });
                }
              }, function(e) {
                // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
                var recoverableResponseCodes = [0, 500, 503];
                if (recoverableResponseCodes.indexOf(e.target.status) != -1 || (e.target.status == 400 && e.target.responseText.indexOf('RequestTimeout') !== -1)) {
                  return _this._recoverableError(file, e.target);
                } else {
                  return _this._fatalError(file, _this.options.dictResponseError.replace("{{statusCode}}", e.target.status), e.target);
                }
              });
            });
          } else if (xhr.status / 100 == 5) {
            _this._recoverableError(file, xhr.status);
          } else {
            return _this._fatalError(file, _this.options.dictResponseError.replace("{{statusCode}}", xhr.status), xhr);
          }
        };

        xhr.onerror = xhr.ontimeout = function(e) {
          return _this._recoverableError(file, e.target);
        };

        file.status = DropzoneS3.PROCESSING;

        params.name = file.name;
        params.size = file.size;

        extend(params, this.options.signing.params);

        this.emit("sign", file, xhr, params);

        xhr.timeout = 20000; // 20 seconds
        xhr.open("POST", this.options.signing.endpoint, true);
        //Send the proper header information along with the request
        xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
        // Convert object to url/POST friendly string and send in body
        xhr.send(param(params));
      } else {
        throw new Error("This file can't be processed because it has already been processed or was rejected.");
      }
    };

    DropzoneS3.prototype.uploadChunk = function(file, chunkNum) {
      var _len1, _j, callbacks = {};

      file.status = DropzoneS3.UPLOADING;
      this.emit("sending", file);

      var progress_callback = (function(_this, file, chunkNum) {
        return function(e) {
          if (file.paused === true && file.upload.chunks[chunkNum].bytesSent < e.loaded) {
            _this.emit("resumed", file);
            file.paused = false;
          }
          file.upload.setChunkProgress(chunkNum, e.loaded);
          // update the last_progress_time for the watcher interval
          file.upload.progressDate = new Date();
          _this.emit("uploadprogress", file, file.upload.getTotalProgress(), file.upload.getBytesSent());
        };
      })(this, file, chunkNum);

      var success_callback = (function(_this, file, chunkNum) {
        return function(e) {
          var _ref;
          if (file.status === DropzoneS3.CANCELED) {
            return;
          }
          file.retryAttemptsRemaining = _this.options.resuming.retryAttempts;
          file.upload.setChunkComplete(chunkNum);
          _this.emit("uploadprogress", file, file.upload.getTotalProgress(), file.upload.getBytesSent());
          setTimeout(function() {
            _this.processQueue();
          }, 0);
        };
      })(this, file, chunkNum);

      var error_callback = (function(_this, file, chunkNum) {
        return function(e) {
          if (file.status === DropzoneS3.CANCELED) {
            return;
          }
          file.upload.resetChunk(chunkNum);
          _this.emit("uploadprogress", file, file.upload.getTotalProgress(), file.upload.getBytesSent());

          // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
          var recoverableResponseCodes = [0, 500, 503];
          if (recoverableResponseCodes.indexOf(e.target.status) != -1 || (e.target.status == 400 && e.target.responseText.indexOf('RequestTimeout') !== -1)) {
            file.upload.resetChunk(chunkNum);
            _this.emit("uploadprogress", file, file.upload.getTotalProgress(), file.upload.getBytesSent());
            return _this._recoverableError(file, e.target);
          } else {
            return _this._fatalError(file, _this.options.dictResponseError.replace("{{statusCode}}", e.target.status), e.target);
          }
        };
      })(this, file, chunkNum);

      // this.emit("sending", file, xhr, formData);
      file.upload.uploadChunk(chunkNum, success_callback, error_callback, progress_callback);
    };

    DropzoneS3.prototype.pauseFile = function(file, message) {
      var validStatuses = [DropzoneS3.PROCESSING, DropzoneS3.UPLOADING, DropzoneS3.FINISHING, DropzoneS3.NOTIFYING];
      if (validStatuses.indexOf(file.status) != -1) {
        file.status = DropzoneS3.PAUSED;
        file.paused = true;
        this.emit("pause", file, message);
      }
    };

    DropzoneS3.prototype.resumeFile = function(file) {
      var _this = this;
      if (file.status === DropzoneS3.PAUSED) {
        file.status = DropzoneS3.QUEUED;
        _this.emit("resume", file);
        return setTimeout(function() {
          return _this.processQueue();
        }, 0);
      }
    };

    DropzoneS3.prototype.cancelUpload = function(file) {
      var _this = this;
      // Abort all sending requests and send an abort request to Amazon to deallocate space
      file.upload.abort(noop, (function(_this, file) {
        return function(e) {
          // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
          var recoverableResponseCodes = [0, 500, 503];
          if (recoverableResponseCodes.indexOf(e.target.status) != -1 || (e.target.status == 400 && e.target.responseText.indexOf('RequestTimeout') !== -1)) {
            return _this._recoverableError(file, e.target);
          } else {
            return _this._fatalError(file, _this.options.dictResponseError.replace("{{statusCode}}", e.target.status), e.target);
          }
        };
      })(this, file));
      file.status = DropzoneS3.CANCELED;
      this.emit("canceled", file);

      return setTimeout(function() {
        return _this.processQueue();
      }, 0);
    };

    DropzoneS3.prototype.removeFile = function(file) {
      window.localStorage.removeItem(this.options.resuming.localStoragePrefix + JSON.stringify({ 'n': file.name, 's': file.size, 'l': file.lastModified }));
      if (file.processed === true) {
        this.cancelUpload(file);
      } else {
        file.upload.reset();
      }
      this.files = without(this.files, file);
      this.emit("removedfile", file);
      if (this.files.length === 0) {
        return this.emit("reset");
      }
    };

    DropzoneS3.prototype.removeAllFiles = function(cancelIfNecessary) {
      var file, _i, _len, _ref;
      if (cancelIfNecessary == null) {
        cancelIfNecessary = false;
      }
      _ref = this.files.slice();
      for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        file = _ref[_i];
        if (file.processed === false || cancelIfNecessary) {
          this.removeFile(file);
        }
      }
      return null;
    };

    DropzoneS3.prototype.finishUpload = function(file) {
      var _this = this;

      file.status = DropzoneS3.FINISHING;
      this.emit("finishing", file);

      var success_callback = (function(_this, file) {
        return function(e) {
          file.s3success = true;
          window.localStorage.removeItem(_this.options.resuming.localStoragePrefix + JSON.stringify({ 'n': file.name, 's': file.size, 'l': file.lastModified }));
          _this.emit("notify", file, function(file) {
            _this._finished(file);
          });
        };
      })(this, file);

      var parts_incomplete_callback = (function(_this, file) {
        return function(e) {
          file.status = DropzoneS3.UPLOADING;
          return setTimeout(function() {
            return _this.processQueue();
          }, 0);
        };
      })(this, file);

      var error_callback = (function(_this, file) {
        return function(e) {
          // http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html
          var recoverableResponseCodes = [0, 500, 503];
          if (recoverableResponseCodes.indexOf(e.target.status) != -1 || (e.target.status == 400 && e.target.responseText.indexOf('RequestTimeout') !== -1)) {
            return _this._recoverableError(file, e.target);
          } else {
            return _this._fatalError(file, _this.options.dictResponseError.replace("{{statusCode}}", e.target.status), e.target);
          }
        };
      })(this, file);

      file.upload.finishUpload(success_callback, parts_incomplete_callback, error_callback);
    };

    DropzoneS3.prototype._finished = function(file, responseText, e) {
      var _this = this;
      file.status = DropzoneS3.SUCCESS;
      if (file.paused === true) {
        _this.emit("resumed", file);
        file.paused = false;
      }
      this.emit("success", file, responseText, e);
      this.emit("complete", file);
      return setTimeout(function() {
        return _this.processQueue();
      }, 0);
    };

    DropzoneS3.prototype._recoverableError = function(file, xhr) {
      var _this = this;
      if (file.status == DropzoneS3.PAUSED) {
        return;
      }
      if (this.options.resuming.automaticRetry && (this.options.resuming.retryAttempts === 0 || file.retryAttemptsRemaining > 0)) {
        this.pauseFile(file, this.options.dictConnectionError.replace("{{seconds}}", this.options.resuming.retryInterval));
        file.retryAttemptsRemaining -= 1;
        return setTimeout(function() {
          _this.resumeFile(file);
        }, _this.options.resuming.retryInterval * 1000);
      } else {
        this.pauseFile(file, _this.options.dictResumeUpload);
      }
    };

    DropzoneS3.prototype._fatalError = function(file, message, xhr) {
      var _this = this;
      file.status = DropzoneS3.ERROR;
      if (file.paused === true) {
        _this.emit("resumed", file);
        file.paused = false;
      }
      window.localStorage.removeItem(this.options.resuming.localStoragePrefix + JSON.stringify({ 'n': file.name, 's': file.size, 'l': file.lastModified }));
      this.emit("error", file, message, xhr);
      this.emit("complete", file);
      return setTimeout(function() {
        return _this.processQueue();
      }, 0);
    };

    return DropzoneS3;

  })(Emitter);

  DropzoneS3.version = "0.1";

  DropzoneS3.options = {};

  DropzoneS3.optionsForElement = function(element) {
    if (element.getAttribute("id")) {
      return DropzoneS3.options[camelize(element.getAttribute("id"))];
    } else {
      return void 0;
    }
  };

  DropzoneS3.instances = [];

  DropzoneS3.forElement = function(element) {
    if (typeof element === "string") {
      element = document.querySelector(element);
    }
    if ((element != null ? element.dropzone : void 0) == null) {
      throw new Error("No DropzoneS3 found for given element. This is probably because you're trying to access it before DropzoneS3 had the time to initialize. Use the `init` option to setup any additional observers on your DropzoneS3.");
    }
    return element.dropzone;
  };

  DropzoneS3.blacklistedBrowsers = [/opera.*Macintosh.*version\/12/i];

  DropzoneS3.isBrowserSupported = function() {
    var capableBrowser, regex, _i, _len, _ref;
    capableBrowser = true;
    if (window.File && window.FileReader && window.FileList && window.Blob && window.FormData && document.querySelector && window.localStorage) {
      if (!("classList" in document.createElement("a"))) {
        capableBrowser = false;
      } else {
        _ref = DropzoneS3.blacklistedBrowsers;
        for (_i = 0, _len = _ref.length; _i < _len; _i++) {
          regex = _ref[_i];
          if (regex.test(navigator.userAgent)) {
            capableBrowser = false;
            continue;
          }
        }
      }
    } else {
      capableBrowser = false;
    }
    return capableBrowser;
  };

  without = function(list, rejectedItem) {
    var item, _i, _len, _results;
    _results = [];
    for (_i = 0, _len = list.length; _i < _len; _i++) {
      item = list[_i];
      if (item !== rejectedItem) {
        _results.push(item);
      }
    }
    return _results;
  };

  camelize = function(str) {
    return str.replace(/[\-_](\w)/g, function(match) {
      return match.charAt(1).toUpperCase();
    });
  };

  DropzoneS3.createElement = function(string) {
    var div;
    div = document.createElement("div");
    div.innerHTML = string;
    return div.childNodes[0];
  };

  DropzoneS3.elementInside = function(element, container) {
    if (element === container) {
      return true;
    }
    while ((element = element.parentNode)) {
      if (element === container) {
        return true;
      }
    }
    return false;
  };

  DropzoneS3.getElement = function(el, name) {
    var element;
    if (typeof el === "string") {
      element = document.querySelector(el);
    } else if (el.nodeType != null) {
      element = el;
    }
    if (element == null) {
      throw new Error("Invalid `" + name + "` option provided. Please provide a CSS selector or a plain HTML element.");
    }
    return element;
  };

  DropzoneS3.getElements = function(els, name) {
    var e, el, elements, _i, _j, _len, _len1, _ref;
    if (els instanceof Array) {
      elements = [];
      try {
        for (_i = 0, _len = els.length; _i < _len; _i++) {
          el = els[_i];
          elements.push(this.getElement(el, name));
        }
      } catch (_error) {
        e = _error;
        elements = null;
      }
    } else if (typeof els === "string") {
      elements = [];
      _ref = document.querySelectorAll(els);
      for (_j = 0, _len1 = _ref.length; _j < _len1; _j++) {
        el = _ref[_j];
        elements.push(el);
      }
    } else if (els.nodeType != null) {
      elements = [els];
    }
    if (!((elements != null) && elements.length)) {
      throw new Error("Invalid `" + name + "` option provided. Please provide a CSS selector, a plain HTML element or a list of those.");
    }
    return elements;
  };

  DropzoneS3.confirm = function(question, accepted, rejected) {
    if (window.confirm(question)) {
      return accepted();
    } else if (rejected != null) {
      return rejected();
    }
  };

  DropzoneS3.isValidFile = function(file, acceptedFiles) {
    var baseMimeType, mimeType, validType, _i, _len;
    if (!acceptedFiles) {
      return true;
    }
    acceptedFiles = acceptedFiles.split(",");
    mimeType = file.type;
    baseMimeType = mimeType.replace(/\/.*$/, "");
    for (_i = 0, _len = acceptedFiles.length; _i < _len; _i++) {
      validType = acceptedFiles[_i];
      validType = validType.trim();
      if (validType.charAt(0) === ".") {
        if (file.name.toLowerCase().indexOf(validType.toLowerCase(), file.name.length - validType.length) !== -1) {
          return true;
        }
      } else if (/\/\*$/.test(validType)) {
        if (baseMimeType === validType.replace(/\/.*$/, "")) {
          return true;
        }
      } else {
        if (mimeType === validType) {
          return true;
        }
      }
    }
    return false;
  };

  if (typeof jQuery !== "undefined" && jQuery !== null) {
    jQuery.fn.dropzone = function(options) {
      return this.each(function() {
        return new DropzoneS3(this, options);
      });
    };
  }

  if (typeof module !== "undefined" && module !== null) {
    module.exports = DropzoneS3;
  } else {
    window.DropzoneS3 = DropzoneS3;
  }

  DropzoneS3.ADDED = "added";

  DropzoneS3.QUEUED = "queued";

  DropzoneS3.PROCESSING = "processing";

  DropzoneS3.UPLOADING = "uploading";

  DropzoneS3.PAUSED = "paused";

  DropzoneS3.FINISHING = "finishing";

  DropzoneS3.NOTIFYING = "notifying";

  DropzoneS3.CANCELED = "canceled";

  DropzoneS3.ERROR = "error";

  DropzoneS3.SUCCESS = "success";


  /*

  Bugfix for iOS 6 and 7
  Source: http://stackoverflow.com/questions/11929099/html5-canvas-drawimage-ratio-bug-ios
  based on the work of https://github.com/stomita/ios-imagefile-megapixel
   */

  detectVerticalSquash = function(img) {
    var alpha, canvas, ctx, data, ey, ih, iw, py, ratio, sy;
    iw = img.naturalWidth;
    ih = img.naturalHeight;
    canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = ih;
    ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    data = ctx.getImageData(0, 0, 1, ih).data;
    sy = 0;
    ey = ih;
    py = ih;
    while (py > sy) {
      alpha = data[(py - 1) * 4 + 3];
      if (alpha === 0) {
        ey = py;
      } else {
        sy = py;
      }
      py = (ey + sy) >> 1;
    }
    ratio = py / ih;
    if (ratio === 0) {
      return 1;
    } else {
      return ratio;
    }
  };

  drawImageIOSFix = function(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    var vertSquashRatio;
    vertSquashRatio = detectVerticalSquash(img);
    return ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh / vertSquashRatio);
  };

}).call(this);
