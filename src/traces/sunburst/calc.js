/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var d3Hierarchy = require('d3-hierarchy');
var isNumeric = require('fast-isnumeric');
var tinycolor = require('tinycolor2');

var Lib = require('../../lib');
var Color = require('../../components/color');

var isArrayOrTypedArray = Lib.isArrayOrTypedArray;

exports.calc = function(gd, trace) {
    var fullLayout = gd._fullLayout;
    var ids = trace.ids;
    var labels = trace.labels;
    var parents = trace.parents;
    // var values = trace.values;
    var cd = [];
    var i, len;

    var parent2children = {};
    var refs = {};
    var addToLookup = function(parent, v) {
        if(parent2children[parent]) parent2children[parent].push(v);
        else parent2children[parent] = [v];
        refs[v] = 1;
    };

    // TODO compute vTotal for all rings?

    if(isArrayOrTypedArray(ids)) {
        len = Math.min(ids.length, parents.length);

        for(i = 0; i < len; i++) {
            if(ids[i]) {
                var id = String(ids[i]);
                var pid = parents[i] ? String(parents[i]) : '';

                cd.push({
                    i: i,
                    id: id,
                    pid: pid,
                    label: labels[i] ? String(labels[i]) : ''
                });
                addToLookup(pid, id);
            }
        }
    } else {
        len = Math.min(labels.length, parents.length);

        for(i = 0; i < len; i++) {
            if(labels[i]) {
                // TODO We could allow some label / parent duplication
                //
                // From AJ:
                //  It would work OK for one level
                //  (multiple rows with the same name and different parents -
                //  or even the same parent) but if that name is then used as a parent
                //  which one is it?
                var label = String(labels[i]);
                var parent = parents[i] ? String(parents[i]) : '';

                cd.push({
                    i: i,
                    id: label,
                    pid: parent,
                    label: label
                });
                addToLookup(parent, label);
            }
        }
    }

    if(!parent2children['']) {
        var impliedRoots = [];
        var k;
        for(k in parent2children) {
            if(!refs[k]) {
                impliedRoots.push(k);
            }
        }

        // if an `id` has no ref in the `parents` array,
        // take it as being the root node

        if(impliedRoots.length === 1) {
            k = impliedRoots[0];
            cd.unshift({
                implied: true,
                id: k,
                label: k,
                pid: '',
                parent: ''
            });
        } else {
            return Lib.warn('Multiple implied roots, cannot build sunburst hierarchy.');
        }
    } else if(parent2children[''].length > 1) {
        var dummyId = Lib.randstr();

        // if multiple rows linked to the root node,
        // add dummy "root of roots" node to make d3 build the hierarchy successfully

        for(i = 0; i < cd.length; i++) {
            if(cd[i].parent === '') cd[i].parent = dummyId;
            if(cd[i].pid === '') cd[i].pid = dummyId;
        }

        cd.unshift({
            implied: true,
            id: dummyId,
            label: '',
            pid: '',
            parent: ''
        });
    }

    var root;
    try {
        root = d3Hierarchy.stratify()
            .id(function(d) { return d.id; })
            .parentId(function(d) { return d.pid; })(cd);
    } catch(e) {
        return Lib.warn('Failed to build sunburst hierarchy.');
    }

    var hierarchy = cd[0].hierarchy = d3Hierarchy.hierarchy(root)
        .count()
        .sort(function(a, b) { return b.value - a.value; });

    var colors = trace.marker.colors || [];
    var colorMap = fullLayout._sunburstcolormap;

    function pullColor(color, id) {
        if(!color) return false;

        color = tinycolor(color);
        if(!color.isValid()) return false;

        color = Color.addOpacity(color, color.getAlpha());
        if(colorMap[id]) colorMap[id] = color;

        return color;
    }

    // TODO keep track of 'root-children' (i.e. branch) for hover info etc.

    hierarchy.each(function(d) {
        var pt = d.data.data;
        var id = d.data.id;

        // N.B. this mutates items in `cd`
        pt.color = pullColor(colors[pt.i], id);
    });

    return cd;
};

// Going outward, sectors inherit from their parents.
// Or if we follow https://bl.ocks.org/mbostock/4348373,
// only leaves inherit from their parents -
// sectors with their own children get new default colors.
// Or perhaps a combination of the two:
// branches can inherit explicitly provided colors,
// but only leaves can inherit default colors?
// That may be too complicated, but it would support a very common color scheme
// in which each inner sector has a unique color but all its descendants share that color.
// Or perhaps this inheritance is itself a setting...
//
// Going inward, a parent inherits from its children if they all match,
// otherwise it picks the next default color.
// This might also be too complicated,
// but would be useful if it happens to give the right result without adding extra rows
// for non-leaf nodes.

/*
 * `calc` filled in (and collated) explicit colors.
 * Now we need to propagate these explicit colors to other traces,
 * and fill in default colors.
 * This is done after sorting, so we pick defaults
 * in the order slices will be displayed
 */
exports.crossTraceCalc = function(gd) {
    var fullLayout = gd._fullLayout;
    var calcdata = gd.calcdata;
    var colorWay = fullLayout.sunburstcolorway;
    var colorMap = fullLayout._sunburstcolormap;

    if(fullLayout.extendsunburstcolors) {
        colorWay = generateExtendedColors(colorWay);
    }
    var dfltColorCount = 0;

    for(var i = 0; i < calcdata.length; i++) {
        var cd = calcdata[i];
        var cd0 = cd[0];

        if(cd0.trace.type !== 'sunburst' || !cd0.hierarchy) continue;

        var done = {};

        cd0.hierarchy.each(function(d) {
            var pt = d.data.data;
            var id = d.data.id;

            if(pt.color === false && !done[id]) {
                // have we seen this label and assigned a color to it in a previous trace?
                if(colorMap[id]) {
                    pt.color = colorMap[id];
                } else if(d.parent) {
                    if(d.parent.parent) {
                        pt.color = d.parent.data.data.color;
                    } else {
                        colorMap[id] = pt.color = colorWay[dfltColorCount % colorWay.length];
                        dfltColorCount++;
                    }
                }

                done[id] = 1;
            }
        });
    }
};

/*
 * pick a default color from the main default set, augmented by
 * itself lighter then darker before repeating
 */
var extendedColorWays = {};

function generateExtendedColors(colorList) {
    var i;
    var colorString = JSON.stringify(colorList);
    var pieColors = extendedColorWays[colorString];

    if(!pieColors) {
        pieColors = colorList.slice();

        for(i = 0; i < colorList.length; i++) {
            pieColors.push(tinycolor(colorList[i]).lighten(20).toHexString());
        }

        for(i = 0; i < colorList.length; i++) {
            pieColors.push(tinycolor(colorList[i]).darken(20).toHexString());
        }
        extendedColorWays[colorString] = pieColors;
    }

    return pieColors;
}
