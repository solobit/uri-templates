/*
UriTemapltes Draft 0.5  Tempolate Processor
(c) marc.portier@gmail.com - 2011
Distributed under ALPv2 
*/

;
(function($){

var RESERVEDCHARS_RE = /[:/?#\[\]@!$&()*+,;=\']/g;
function encodeNormal(val) {
    return encodeURIComponent(val).replace(RESERVEDCHARS_RE, function(s) {return escape(s)} );
}
function encodeReserved(val) {
    return encodeURI(val);
}

//-----------------------------------various template syntax features & settings
var simpleSet = { 
    prefix : "", 
    joiner : ",", 
    encode : encodeNormal,
    add_fn : function(lbl, val, expl, c) {
        c = c || '=';
        return (expl && lbl) ? lbl + c + val : val;
    }
};
var reservedSet = { 
    prefix : "", 
    joiner : ",", 
    encode : encodeReserved,
    add_fn : function(lbl, val, expl, c) {
        c = c || '=';
        return expl ? (lbl ? lbl + c + val : val) : val;
    }
};
var pathParamSet = { 
    prefix : ";", 
    joiner : ";", 
    encode : encodeNormal,
    add_fn : function(lbl, val, expl, c) {
        var c = '=';
        return lbl ? ( val && val.length > 0 ? lbl + c + val : lbl) : val;
    }
};
var formParamSet = { 
    prefix : "?", 
    joiner : "&", 
    encode : encodeNormal,
    add_fn : function(lbl, val, expl, c) {
        var c = '=';
        return lbl ? lbl + c + val : val;
    }
};
var pathHierarchySet = { 
    prefix : "/", 
    joiner : "/", 
    encode : encodeNormal,
    add_fn : function(lbl, val, expl, c) {
        c = c || '=';
        return (expl && lbl) ? ( val && val.length > 0 ? lbl + c + val : lbl) : val;
    }
};
var labelSet = { 
    prefix : ".", 
    joiner : ".", 
    encode : encodeNormal,
    add_fn : function(lbl, val, expl, c) {
        c = c || '=';
        return (expl && lbl) ? ( val && val.length > 0 ? lbl + c + val : lbl) : val;
    }
};


var OPS_SETTINGS = function(ops) {
    switch(ops) {
        case ''  : return simpleSet; 
        case '+' : return reservedSet; 
        case ';' : return pathParamSet;
        case '?' : return formParamSet;
        case '/' : return pathHierarchySet;
        case '.' : return labelSet;
        default  : throw "Unexpected operator: '"+ops+"'"; 
    }
}

var noneLblModifier = function(name, k) {
    return name;
};
var compLblModifier = function(name, k) {
    return k;
};
var fullLblModifier = function(name, k) {
    return name + (k ? "." + k : "");
};

var EXPLODELBL_MODIFIER = function(expl) {
    expl = expl || '';
    switch(expl) {
        case '' : return noneLblModifier; 
        case '*': return compLblModifier;
        case '+': return fullLblModifier;
    }
};

var PARTVALUE_MODIFIER = function(part, nums) {
    part = part || '';
    switch (part) {
        case ':' : return function(v) { // substring
            v = v.toString();
            if (nums >= 0) {
                return v.substring(0,nums);
            } else {
                return v.substring(v.length + nums);
            }
        };
        case '^' : return function(v) { // remainder
            v = v.toString();
            if (nums >= 0) {
                return v.substring(nums);
            } else {
                return v.substring(0, v.length + nums);
            }
        };
        default  : return function(v) {
            return v;
        };
    }
};


//---------------------------------------------- objects in use

/**
 * Create a runtime cache around retrieved values from the context.
 * This allows for dynamic (function) results to be kept the same for multiple expansions within one template
 * Uses key-value tupples in stead to be able to cache null values as well
 */
function CachingContext(context) {
    this.raw = context;
    this.cache = {};
}

CachingContext.prototype.get = function(key) {
    var val = this.raw[key];
    var result = val;
    
    if ($.isFunction(val)) { // check function-result-cache
        var tupple = this.cache[key];
        if (tupple != null) { 
            result = tupple.val;
        } else {
            result = val(this.raw);
            this.cache[key] = {key: key, val: result}; // by storing tupples we make sure a null return is validly consistent too in expansions
        }
    }
    
    return result;
}

function UriTemplate(set) {
    this.set = set;
};
UriTemplate.prototype.expand = function(context) {
    var cache = new CachingContext(context);
    var res = "";
    var cnt = this.set.length;
    for (var i = 0; i<cnt; i++ ) {
        res += this.set[i].expand(cache);
    }
    return res;
}

function Literal(txt ) {
    this.txt = txt;
}

Literal.prototype.expand = function() {
    return this.txt;
};

function Expression(ops, vars ) {
    this.opss = OPS_SETTINGS(ops);
    this.vars = vars;
};

Expression.prototype.expand = function(context) {
    var opss = this.opss;
    var joiner = opss.prefix;
    var res = "";
    var cnt = this.vars.length;
    for (var i = 0 ; i< cnt; i++) {
        var varspec = this.vars[i];
        varspec.iterate(context, opss.encode, function(key, val, explodes, del) {
            var segm = opss.add_fn(key, val, explodes, del);
            if (segm != null) {
                res += joiner + segm;
                joiner = opss.joiner;
            }
        });
    }
    return res;
};

function VarSpec (name, expl, part, nums) {
    this.name = name;
    this.explLbl = EXPLODELBL_MODIFIER(expl);
    this.explodes = !!expl; // make it boolean
    this.partVal = PARTVALUE_MODIFIER(part, nums);
};

VarSpec.prototype.iterate = function(context, encoder, adder) {
    var val = context.get(this.name);

    var isArr = false;
    var isObj = false;
    var isUndef = false;  //note: "" is empty but not undef
    var fallback = false;
    
    if (val != null) {
        isArr = (val.constructor === Array);
        isObj = (val.constructor === Object);
    } 
    isUndef = (val == null || (isArr && val.length == 0) || (isObj && $.isEmptyObject(val)));
    
    if (isUndef) return; // ignore empty values 
    
    if (!this.explodes) { // no exploding: wrap values into string
        var joined = "";
        var joiner = "";
        if (isArr) {
            var cnt = val.length;
            for (var i=0; i<cnt; i++) {
                if (val[i] != null) {
                    joined += joiner + encoder(val[i]);
                    joiner = ",";
                }
            }
        } else if (isObj) {
            for (k in val) {
                if (val[k] != null) {
                    joined += joiner + k + ',' + encoder(val[k]);
                    joiner = ",";
                }
            }
        } else {
            joined = (val == null) ? null : encoder(val);
        }       
        
        if (joined != null) {
            //TODO redo this so the partial modifier can work on unescaped values!
            // one idea is to pass the encoder function down to the partVal function and let it join & encode after trimming 
            // (odd for from-end logic maybe) or else have some way of counting %HH as single chars
            adder(this.name, this.partVal(joined));
        }

    // below cases are all exploding:
    } else if (isArr) {
        var lbl = this.explLbl(this.name);
        var cnt = val.length;
        for (var i=0; i<cnt; i++) {
            adder(lbl, encoder(val[i]), true, '.' );
        }
    } else if (isObj) {
        for (k in val) {
            adder(this.explLbl(this.name, k),  encoder(val[k]) , true);
        }
    } else { // explode-requested, but single value
        adder(this.explLbl(this.name), encoder(val));
    }
};

//----------------------------------------------parsing logic
// How each varspec should look like
var VARSPEC_RE=/([A-Za-z0-9_][A-Za-z0-9_.]*)((\*)|(:)([0-9]+))?/;

var match2varspec = function(m) {
    var name = m[1];
    var expl = m[3];
    var part = m[4];
    var nums = parseInt(m[5]);
    
    return new VarSpec(name, expl, part, nums);
};


// Splitting varspecs in list with:
var LISTSEP=",";

// How each template should look like
var TEMPL_RE=/({([+.;?/])?(([A-Za-z0-9_][A-Za-z0-9_.]*)(\*|:([0-9]+))?(,([A-Za-z0-9_][A-Za-z0-9_.]*)(\*|:([0-9]+))?)*)})/g;
// Note: reserved operators: |!@ are left out of the regexp in order to make those templates degrade into literals 
// (as expected by the spec - see tests.html "reserved operators")


var match2expression = function(m) {
    var expr = m[0];
    var ops = m[2] || '';
    var vars = m[3].split(LISTSEP);
    var len = vars.length;
    for (var i=0; i<len; i++) {
        var match;
        if ( (match = vars[i].match(VARSPEC_RE)) == null) {
            throw "unexpected parse error in varspec: " + vars[i];
        }
        vars[i] = match2varspec(match);
    }
    
    return new Expression(ops, vars);
};


var pushLiteralSubstr = function(set, src, from, to) {
    if (from < to) {
        var literal = src.substr(from, to - from);
        set.push(new Literal(literal));
    }
};

var parse = function(str) {
    var lastpos = 0;
    var comp = [];
        
    var match;
    var pattern = TEMPL_RE;
    pattern.lastIndex = 0; // just to be sure
    while ((match = pattern.exec(str)) != null) {
        var newpos = match.index;
        pushLiteralSubstr(comp, str, lastpos, newpos);
        
        comp.push(match2expression(match));
        lastpos = pattern.lastIndex;
    }
    pushLiteralSubstr(comp, str, lastpos, str.length);

    return new UriTemplate(comp);
};


//-------------------------------------------comments and ideas

//TODO: consider building cache of previously parsed uris or even parsed expressions?



//------------------------------------- availability in jquery context
$.extend({"uritemplate": parse});

})(jQuery);
