/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var Lib = require('../../lib');
var attributes = require('./attributes');
var handleDomainDefaults = require('../../plots/domain').defaults;
var handleTextDefaults = require('../pie/defaults').handleTextDefaults;
var handleTitleDefaults = require('../pie/defaults').handleTitleDefaults;

module.exports = function supplyDefaults(traceIn, traceOut, defaultColor, layout) {
    function coerce(attr, dflt) {
        return Lib.coerce(traceIn, traceOut, attributes, attr, dflt);
    }

    var labels = coerce('labels');
    var parents = coerce('parents');

    if(!labels.length || !parents.length) {
        traceOut.visible = false;
        return;
    }

    var vals = coerce('values');
    if(vals && vals.length) coerce('branchvalues');

    coerce('level');
    coerce('maxdepth');

    var lineWidth = coerce('marker.line.width');
    if(lineWidth) coerce('marker.line.color');

    coerce('marker.colors');

    coerce('sort');
    coerce('direction');
    coerce('rotation');

    handleDomainDefaults(traceOut, layout, coerce);
    handleTextDefaults(traceIn, traceOut, coerce, layout);
    handleTitleDefaults(traceIn, traceOut, coerce, layout);

    // do not support transforms for now
    traceOut._length = null;
};
