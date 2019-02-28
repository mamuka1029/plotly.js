/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var colorAttrs = require('../../components/color/attributes');
var plotAttrs = require('../../plots/attributes');
var hovertemplateAttrs = require('../../components/fx/hovertemplate_attributes');
var domainAttrs = require('../../plots/domain').attributes;
var pieAtts = require('../pie/attributes');

var extendFlat = require('../../lib/extend').extendFlat;

module.exports = {
    labels: {
        valType: 'data_array',
        editType: 'calc',
        description: [
        ].join(' ')
    },
    parents: {
        valType: 'data_array',
        editType: 'calc',
        description: [
            'If `ids` is filled, `parents` items are understood to be "ids" themselves.'
        ].join(' ')
    },

    // TODO or are going with `value` (singular, like for isosurface) now?
    // TODO
    values: {
        valType: 'data_array',
        editType: 'calc',
        description: [
            ''
        ].join(' ')
    },
    branchvalues: {
        valType: 'enumerated',
        values: ['total', 'extra'],
        dflt: 'extra',
        editType: 'calc',
        role: 'info',
        description: ''
    },

    level: {
        valType: 'any',
        editType: 'plot',
        role: 'info',
        dflt: '',
        description: [
            'Sets the level from which this sunburst trace hierarchy is rendered.',
            'Set `level` to `\'\'` to start the sunburst from the root node in the hierarchy.',
            'Must be ids if ...'
        ].join(' ')
    },
    maxdepth: {
        valType: 'integer',
        editType: 'plot',
        role: 'info',
        // TODO or maybe something like 3 or 4 would be better?
        dflt: -1,
        description: [
            'Sets the number of rendered sunburst rings from any given `level`.',
            'Set `maxdepth` to *-1* to render all the levels in the hierarchy.'
        ].join(' ')
    },

    // TODO?
    // root: {
    //     visible: {},
    //     color: {}
    //     // but styling could also be done via first item in arrayOk attributes?
    // },

    marker: {
        // TODO hmm not sure how this is going to work??
        colors: {
            valType: 'data_array',  // TODO 'color_array' ?
            editType: 'calc',
            description: [
                'Sets the color of each sector of this sunburst chart.',
                'If not specified, the default trace color set is used',
                'to pick the sector colors.'
            ].join(' ')
        },

        // colorinheritance: {
        //     valType: 'enumerated',
        //     values: ['per-branch', 'per-label', false]
        // },

        // TODO special styling for leaf nodes?
        // leafopacity: {},

        line: {
            color: {
                valType: 'color',
                role: 'style',
                dflt: colorAttrs.defaultLine,
                // TODO should arrayOk here mean per-root-level branch?
                arrayOk: true,
                editType: 'style',
                description: [
                    'Sets the color of the line enclosing each sector.'
                ].join(' ')
            },
            width: {
                valType: 'number',
                role: 'style',
                min: 0,
                // TODO or maybe 1 looks better?
                dflt: 0,
                arrayOk: true,
                editType: 'style',
                description: [
                    'Sets the width (in px) of the line enclosing each sector.'
                ].join(' ')
            },
            editType: 'calc'
        },
        editType: 'calc'
    },

    text: pieAtts.text,
    textinfo: pieAtts.textinfo,
    textfont: pieAtts.textfont,

    hovertext: pieAtts.hovertext,
    // TODO add more flags?? e.g. parent, branch
    hoverinfo: extendFlat({}, plotAttrs.hoverinfo, {
        flags: ['label', 'text', 'value', 'percent', 'name']
    }),
    hovertemplate: hovertemplateAttrs({}, {
        keys: ['label', 'color', 'value', 'percent', 'text']
    }),

    // TODO
    // Can sunburst traces really have outside text labels? Maybe just for the
    // outer ring?
    textposition: pieAtts.textposition,
    insidetextfont: pieAtts.insidetextfont,
    outsidetextfont: pieAtts.outsidetextfont,

    // TODO
    // Maybe just use `name` instead?
    // Or just use the root level?
    title: extendFlat({}, pieAtts.title),

    domain: domainAttrs({name: 'sunburst', trace: true, editType: 'calc'}),

    // TODO is this a thing? Combing logic with `root`?
    hole: extendFlat({}, pieAtts.hole, {
        // TODO something bigger?
        dflt: 0,
        description: [
            'Sets the fraction of the radius to cut out of the sunburst.'
        ].join(' ')
    }),

    // TODO Might want the same defaults as for pie traces!!
    // TODO maybe drop for v1 release
    sort: pieAtts.sort,
    direction: pieAtts.direction,
    rotation: pieAtts.rotation
};
