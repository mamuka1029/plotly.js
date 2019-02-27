/**
* Copyright 2012-2019, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var d3 = require('d3');
var d3Hierarchy = require('d3-hierarchy');

var Fx = require('../../components/fx');
var Color = require('../../components/color');
var Drawing = require('../../components/drawing');
var Lib = require('../../lib');
var Events = require('../../lib/events');
var svgTextUtils = require('../../lib/svg_text_utils');
var setCursor = require('../../lib/setcursor');

var styleOne = require('./style').styleOne;

/**
 * See
 * - https://beta.observablehq.com/@mbostock/d3-zoomable-sunburst
 * - https://www.anychart.com/products/anychart/gallery/Sunburst_Charts/Coffee_Flavour_Wheel.php
 * - https://github.com/d3/d3-hierarchy
 * - https://github.com/plotly/dash-sunburst/blob/master/src/lib/d3/sunburst.js
 */

module.exports = function plot(gd, cdmodule) {
    var fullLayout = gd._fullLayout;
    var layer = fullLayout._sunburstlayer;
    var gs = fullLayout._size;

    Lib.makeTraceGroups(layer, cdmodule, 'trace').each(function(cd) {
        var gTrace = d3.select(this);
        var cd0 = cd[0];
        var trace = cd0.trace;
        var hierarchy = cd0.hierarchy;
        var maxDepth = trace.maxdepth >= 0 ? trace.maxdepth : Infinity;

        var domain = trace.domain;
        var vpw = gs.w * (domain.x[1] - domain.x[0]);
        var vph = gs.h * (domain.y[1] - domain.y[0]);
        var rMax = 0.5 * Math.min(vpw, vph);
        var cx = cd0.cx = gs.l + gs.w * (domain.x[1] + domain.x[0]) / 2;
        var cy = cd0.cy = gs.t + gs.h * (1 - domain.y[0]) - vph / 2;

        function render(entry) {
            var slices = gTrace.selectAll('g.slice');

            if(!entry) {
                slices.remove();
                return;
            }

            // TODO or slice(1) of that will trace.title in middle?
            var sliceData = partition(entry)
                .descendants()
                .filter(function(d) { return d.y1 <= maxDepth; });

            slices = slices.data(sliceData, function(d) { return d.data.id; });

            slices.enter().append('g')
                .classed('slice', true);
            slices.exit().remove();

            var maxY = Math.min(entry.height + 1, maxDepth);
            var y2rpx = function(y) { return y / maxY * rMax; };
            var rx2px = function(r, x) { return [r * Math.cos(x), -r * Math.sin(x)]; };

            var hasOutsideText = false;
            var quadrants = [
                [[], []], // y<0: x<0, x>=0
                [[], []]  // y>=0: x<0, x>=0
            ];

            slices.each(function(pt) {
                var sliceTop = d3.select(this);

                var slicePath = Lib.ensureSingle(sliceTop, 'path', 'surface', function(s) {
                    s.style('pointer-events', 'all');
                });

                pt.rpx0 = y2rpx(pt.y0);
                pt.rpx1 = y2rpx(pt.y1);
                pt.xmid = (pt.x0 + pt.x1) / 2;
                pt.pxmid = rx2px(pt.rpx1, pt.xmid);
                pt.midangle = -(pt.xmid - Math.PI / 2);
                pt.halfangle = 0.5 * Math.min(Lib.angleDelta(pt.x0, pt.x1), Math.PI);
                pt.ring = 1 - (pt.rpx0 / pt.rpx1) - trace.hole;
                pt.rInscribed = getInscribedRadiusFraction(pt, trace);
                quadrants[pt.pxmid[1] < 0 ? 0 : 1][pt.pxmid[0] < 0 ? 0 : 1].push(pt);

                // TODO what to do with hole ?!?
                slicePath.attr('d', Lib.pathAnnulus(
                    y2rpx(pt.y0), y2rpx(pt.y1),
                    pt.x0, pt.x1,
                    cx, cy
                ));

                slicePath
                    .call(styleOne, pt, trace)
                    .call(attachHoverHandlers, gd, cd);

                if(pt.children) slicePath.call(setCursor, 'pointer');

                // TODO or call restyle, but would that smoothly transition?
                slicePath.on('click', function(pt) {
                    var clickVal = Events.triggerHandler(gd, 'plotly_sunburstclick', pt);
                    if(clickVal === false) return;

                    if(!pt.children) return;

                    var fullLayoutNow = gd._fullLayout;
                    if(gd._dragging || fullLayoutNow.hovermode === false) return;

                    var id = pt.data.id;
                    if(pt.parent) {
                        render(findEntryWithLevel(hierarchy, id));
                        // TODO event data
                    } else {
                        render(findEntryWithChild(hierarchy, id));
                        // TODO event data
                    }
                });

                var textPosition = pt.y1 < maxY ? 'inside' : 'auto';
                pt.text = pt.data.data.label;

                var sliceTextGroup = Lib.ensureSingle(sliceTop, 'g', 'slicetext');
                var sliceText = Lib.ensureSingle(sliceTextGroup, 'text', '', function(s) {
                    // prohibit tex interpretation until we can handle
                    // tex and regular text together
                    s.attr('data-notex', 1);
                });

                sliceText.text(pt.text)
                    .attr({
                        'class': 'slicetext',
                        transform: '',
                        'text-anchor': 'middle'
                    })
                    .call(Drawing.font, textPosition === 'outside' ?
                      determineOutsideTextFont(trace, pt, gd._fullLayout.font) :
                      determineInsideTextFont(trace, pt, gd._fullLayout.font))
                    .call(svgTextUtils.convertToTspans, gd);

                // position the text relative to the slice
                var textBB = Drawing.bBox(sliceText.node());
                var transform;

                // TODO DRY up with pie
                if(textPosition === 'outside') {
                    transform = transformOutsideText(textBB, pt);
                } else {
                    transform = transformInsideText(textBB, pt, cd0);
                    if(textPosition === 'auto' && transform.scale < 1) {
                        sliceText.call(Drawing.font, trace.outsidetextfont);
                        if(trace.outsidetextfont.family !== trace.insidetextfont.family ||
                                trace.outsidetextfont.size !== trace.insidetextfont.size) {
                            textBB = Drawing.bBox(sliceText.node());
                        }
                        transform = transformOutsideText(textBB, pt);
                    }
                }

                var translateX = cx + pt.pxmid[0] * transform.rCenter + (transform.x || 0);
                var translateY = cy + pt.pxmid[1] * transform.rCenter + (transform.y || 0);

                // save some stuff to use later ensure no labels overlap
                if(transform.outside) {
                    pt.px0 = rx2px(pt.rpx0, pt.x0);
                    pt.px1 = rx2px(pt.rpx1, pt.x1);
                    pt.cxFinal = cx;
                    pt.cyFinal = cy;
                    pt.yLabelMin = translateY - textBB.height / 2;
                    pt.yLabelMid = translateY;
                    pt.yLabelMax = translateY + textBB.height / 2;
                    pt.labelExtraX = 0;
                    pt.labelExtraY = 0;
                    hasOutsideText = true;
                }

                sliceText.attr('transform',
                    'translate(' + translateX + ',' + translateY + ')' +
                    (transform.scale < 1 ? ('scale(' + transform.scale + ')') : '') +
                    (transform.rotate ? ('rotate(' + transform.rotate + ')') : '') +
                    'translate(' +
                        (-(textBB.left + textBB.right) / 2) + ',' +
                        (-(textBB.top + textBB.bottom) / 2) +
                    ')');
            });

            if(hasOutsideText) {
                scootLabels(quadrants, trace);
            }

            // DRY up with Pie.plot !!
            slices.each(function(pt) {
                if(pt.labelExtraX || pt.labelExtraY) {
                    // first move the text to its new location
                    var sliceTop = d3.select(this);
                    var sliceText = sliceTop.select('g.slicetext text');

                    sliceText.attr('transform',
                        'translate(' + pt.labelExtraX + ',' + pt.labelExtraY + ')' +
                        sliceText.attr('transform'));

                    // then add a line to the new location
                    var lineStartX = cx + pt.pxmid[0];
                    var lineStartY = cy + pt.pxmid[1];
                    var textLinePath = 'M' + lineStartX + ',' + lineStartY;
                    var finalX = (pt.yLabelMax - pt.yLabelMin) * (pt.pxmid[0] < 0 ? -1 : 1) / 4;

                    if(pt.labelExtraX) {
                        var yFromX = pt.labelExtraX * pt.pxmid[1] / pt.pxmid[0];
                        var yNet = pt.yLabelMid + pt.labelExtraY - (cy + pt.pxmid[1]);

                        if(Math.abs(yFromX) > Math.abs(yNet)) {
                            textLinePath +=
                                'l' + (yNet * pt.pxmid[0] / pt.pxmid[1]) + ',' + yNet +
                                'H' + (lineStartX + pt.labelExtraX + finalX);
                        } else {
                            textLinePath += 'l' + pt.labelExtraX + ',' + yFromX +
                                'v' + (yNet - yFromX) +
                                'h' + finalX;
                        }
                    } else {
                        textLinePath +=
                            'V' + (pt.yLabelMid + pt.labelExtraY) +
                            'h' + finalX;
                    }

                    Lib.ensureSingle(sliceTop, 'path', 'textline')
                        .call(Color.stroke, trace.outsidetextfont.color)
                        .attr({
                            'stroke-width': Math.min(2, trace.outsidetextfont.size / 8),
                            d: textLinePath,
                            fill: 'none'
                        });
                } else {
                    d3.select(this).select('path.textline').remove();
                }
            });
        }

        render(findEntryWithLevel(hierarchy, trace.level));
    });
};

// x[0-1] keys are angles [radians]
// y[0-1] keys are hierarchy height [integers]
function partition(entry) {
    return d3Hierarchy.partition()
        .size([2 * Math.PI, entry.height + 1])(entry);
}

function findEntryWithLevel(hierarchy, level) {
    var out;
    if(level) {
        hierarchy.eachAfter(function(d) {
            if(!out && d.data.id === level) {
                out = d.copy();
            }
        });
    }
    return out || hierarchy;
}

function findEntryWithChild(hierarchy, childId) {
    var out;
    hierarchy.eachAfter(function(d) {
        if(!out) {
            var children = d.children || [];
            for(var i = 0; i < children.length; i++) {
                var child = children[i];
                if(child.data.id === childId) {
                    out = d.copy();
                }
            }
        }
    });
    return out || hierarchy;
}

function attachHoverHandlers(slicePath, gd, cd) {
    var cd0 = cd[0];
    var trace = cd0.trace;

    // hover state vars
    // have we drawn a hover label, so it should be cleared later
    var hasHoverLabel = false;
    // have we emitted a hover event, so later an unhover event should be emitted
    // note that click events do not depend on this - you can still get them
    // with hovermode: false or if you were earlier dragging, then clicked
    // in the same slice that you moused up in
    var hasHoverEvent = false;

    slicePath.on('mouseover', function(pt) {
        var fullLayoutNow = gd._fullLayout;

        if(gd._dragging || fullLayoutNow.hovermode === false) return;

        var traceNow = gd._fullData[trace.index];
        var ptNumber = pt.data.data.i;

        var _cast = function(astr) {
            return Lib.castOption(traceNow, ptNumber, astr);
        };

        var hovertemplate = _cast('hovertemplate');
        var hoverinfo = Fx.castHoverinfo(traceNow, fullLayoutNow, ptNumber);

        if(hovertemplate || (hoverinfo && hoverinfo !== 'none' && hoverinfo !== 'skip')) {
            var rInscribed = pt.rInscribed;
            var hoverCenterX = cd0.cx + pt.pxmid[0] * (1 - rInscribed);
            var hoverCenterY = cd0.cy + pt.pxmid[1] * (1 - rInscribed);

            var separators = fullLayoutNow.separators;

            var thisText = [];
            if(hoverinfo) {
                var parts = hoverinfo === 'all' ?
                    traceNow._module.attributes.hoverinfo.flags :
                    hoverinfo.split('+');

                var _push = function(flag, k) {
                    if(hoverinfo && parts.indexOf(flag) !== -1) {
                        thisText.push(pt.data.data[k || flag]);
                    }
                };

                _push('label');

                // TODO ...
            }

            Fx.loneHover({
                x0: hoverCenterX - rInscribed * pt.rpx1,
                x1: hoverCenterX + rInscribed * pt.rpx1,
                y: hoverCenterY,
                idealAlign: pt.pxmid[0] < 0 ? 'left' : 'right',
                trace: traceNow,
                text: thisText.join('<br>'),
                name: (hovertemplate || hoverinfo.indexOf('name') !== -1) ? traceNow.name : undefined,
                color: _cast('hoverlabel.bgcolor') || pt.color,
                borderColor: _cast('hoverlabel.bordercolor'),
                fontFamily: _cast('hoverlabel.font.family'),
                fontSize: _cast('hoverlabel.font.size'),
                fontColor: _cast('hoverlabel.font.color'),
                hovertemplate: hovertemplate,
                hovertemplateLabels: pt,
                eventData: [makeEventData(pt, traceNow)]
            }, {
                container: fullLayoutNow._hoverlayer.node(),
                outerContainer: fullLayoutNow._paper.node(),
                gd: gd
            });

            hasHoverLabel = true;
        }

        gd.emit('plotly_hover', {
            points: [makeEventData(pt, traceNow)],
            event: d3.event
        });
        hasHoverEvent = true;
    });

    slicePath.on('mouseout', function(evt) {
        var fullLayoutNow = gd._fullLayout;
        var traceNow = gd._fullData[trace.index];
        var pt = d3.select(this).datum();

        if(hasHoverEvent) {
            evt.originalEvent = d3.event;
            gd.emit('plotly_unhover', {
                points: [makeEventData(pt, traceNow)],
                event: d3.event
            });
            hasHoverEvent = false;
        }

        if(hasHoverLabel) {
            Fx.loneUnhover(fullLayoutNow._hoverlayer.node());
            hasHoverLabel = false;
        }
    });
}

// TODO !!
function makeEventData(pt) {
    return pt;
}

function determineOutsideTextFont(trace, pt, layoutFont) {
    var ptNumber = pt.data.data.i;

    var color = Lib.castOption(trace, ptNumber, 'outsidetextfont.color') ||
        Lib.castOption(trace, ptNumber, 'textfont.color') ||
        layoutFont.color;

    var family = Lib.castOption(trace, ptNumber, 'outsidetextfont.family') ||
        Lib.castOption(trace, ptNumber, 'textfont.family') ||
        layoutFont.family;

    var size = Lib.castOption(trace, ptNumber, 'outsidetextfont.size') ||
        Lib.castOption(trace, ptNumber, 'textfont.size') ||
        layoutFont.size;

    return {
        color: color,
        family: family,
        size: size
    };
}

function determineInsideTextFont(trace, pt, layoutFont) {
    var ptNumber = pt.data.data.i;

    var customColor = Lib.castOption(trace, ptNumber, 'insidetextfont.color');
    if(!customColor && trace._input.textfont) {

        // Why not simply using trace.textfont? Because if not set, it
        // defaults to layout.font which has a default color. But if
        // textfont.color and insidetextfont.color don't supply a value,
        // a contrasting color shall be used.
        customColor = Lib.castOption(trace._input, ptNumber, 'textfont.color');
    }

    var family = Lib.castOption(trace, ptNumber, 'insidetextfont.family') ||
        Lib.castOption(trace, ptNumber, 'textfont.family') ||
        layoutFont.family;

    var size = Lib.castOption(trace, ptNumber, 'insidetextfont.size') ||
        Lib.castOption(trace, ptNumber, 'textfont.size') ||
        layoutFont.size;

    return {
        color: customColor || Color.contrast(pt.color),
        family: family,
        size: size
    };
}

function getInscribedRadiusFraction(pt, trace) {
    if(pt.rpx0 === 0 && pt.xmid === Math.PI && !trace.hole) {
        // special case of 100% with no hole
        return 1;
    } else {
        return Math.max(0, Math.min(
            1 / (1 + 1 / Math.sin(pt.halfangle)),
            pt.ring / 2
        ));
    }
}

// TODO reuse from Pie.plot
function transformInsideText(textBB, pt) {
    var textDiameter = Math.sqrt(textBB.width * textBB.width + textBB.height * textBB.height);
    var textAspect = textBB.width / textBB.height;
    var halfAngle = pt.halfangle;
    var ring = pt.ring;
    var rInscribed = pt.rInscribed;

    // max size text can be inserted inside without rotating it
    // this inscribes the text rectangle in a circle, which is then inscribed
    // in the slice, so it will be an underestimate, which some day we may want
    // to improve so this case can get more use
    var transform = {
        scale: rInscribed * pt.rpx1 * 2 / textDiameter,

        // and the center position and rotation in this case
        rCenter: 1 - rInscribed,
        rotate: 0
    };

    if(transform.scale >= 1) return transform;

    // max size if text is rotated radially
    var Qr = textAspect + 1 / (2 * Math.tan(halfAngle));
    var maxHalfHeightRotRadial = pt.rpx1 * Math.min(
        1 / (Math.sqrt(Qr * Qr + 0.5) + Qr),
        ring / (Math.sqrt(textAspect * textAspect + ring / 2) + textAspect)
    );
    var radialTransform = {
        scale: maxHalfHeightRotRadial * 2 / textBB.height,
        rCenter: Math.cos(maxHalfHeightRotRadial / pt.rpx1) -
            maxHalfHeightRotRadial * textAspect / pt.rpx1,
        rotate: (180 / Math.PI * pt.midangle + 720) % 180 - 90
    };

    // max size if text is rotated tangentially
    var aspectInv = 1 / textAspect;
    var Qt = aspectInv + 1 / (2 * Math.tan(halfAngle));
    var maxHalfWidthTangential = pt.rpx1 * Math.min(
        1 / (Math.sqrt(Qt * Qt + 0.5) + Qt),
        ring / (Math.sqrt(aspectInv * aspectInv + ring / 2) + aspectInv)
    );
    var tangentialTransform = {
        scale: maxHalfWidthTangential * 2 / textBB.width,
        rCenter: Math.cos(maxHalfWidthTangential / pt.rpx1) -
            maxHalfWidthTangential / textAspect / pt.rpx1,
        rotate: (180 / Math.PI * pt.midangle + 810) % 180 - 90
    };

    // if we need a rotated transform, pick the biggest one
    // even if both are bigger than 1
    var rotatedTransform = tangentialTransform.scale > radialTransform.scale ?
        tangentialTransform :
        radialTransform;

    return (transform.scale < 1 && rotatedTransform.scale > transform.scale) ?
        rotatedTransform :
        transform;
}

// TODO reuse from Pie.plot
function transformOutsideText(textBB, pt) {
    var x = pt.pxmid[0];
    var y = pt.pxmid[1];
    var dx = textBB.width / 2;
    var dy = textBB.height / 2;

    if(x < 0) dx *= -1;
    if(y < 0) dy *= -1;

    return {
        scale: 1,
        rCenter: 1,
        rotate: 0,
        x: dx + Math.abs(dy) * (dx > 0 ? 1 : -1) / 2,
        y: dy / (1 + x * x / (y * y)),
        outside: true
    };
}

// TODO reuse from Pie.plot
function scootLabels(quadrants, trace) {
    var xHalf, yHalf, equatorFirst, farthestX, farthestY,
        xDiffSign, yDiffSign, thisQuad, oppositeQuad,
        wholeSide, i, thisQuadOutside, firstOppositeOutsidePt;

    function topFirst(a, b) { return a.pxmid[1] - b.pxmid[1]; }
    function bottomFirst(a, b) { return b.pxmid[1] - a.pxmid[1]; }

    function scootOneLabel(thisPt, prevPt) {
        if(!prevPt) prevPt = {};

        var prevOuterY = prevPt.labelExtraY + (yHalf ? prevPt.yLabelMax : prevPt.yLabelMin);
        var thisInnerY = yHalf ? thisPt.yLabelMin : thisPt.yLabelMax;
        var thisOuterY = yHalf ? thisPt.yLabelMax : thisPt.yLabelMin;
        var thisSliceOuterY = thisPt.cyFinal + farthestY(thisPt.px0[1], thisPt.px1[1]);
        var newExtraY = prevOuterY - thisInnerY;

        var xBuffer, i, otherPt, otherOuterY, otherOuterX, newExtraX;

        // make sure this label doesn't overlap other labels
        // this *only* has us move these labels vertically
        if(newExtraY * yDiffSign > 0) thisPt.labelExtraY = newExtraY;

        // make sure this label doesn't overlap any slices
        if(!Array.isArray(trace.pull)) return; // this can only happen with array pulls

        for(i = 0; i < wholeSide.length; i++) {
            otherPt = wholeSide[i];

            // overlap can only happen if the other point is pulled more than this one
            if(otherPt === thisPt || (
                (helpers.castOption(trace.pull, thisPt.pts) || 0) >=
                (helpers.castOption(trace.pull, otherPt.pts) || 0))
            ) {
                continue;
            }

            if((thisPt.pxmid[1] - otherPt.pxmid[1]) * yDiffSign > 0) {
                // closer to the equator - by construction all of these happen first
                // move the text vertically to get away from these slices
                otherOuterY = otherPt.cyFinal + farthestY(otherPt.px0[1], otherPt.px1[1]);
                newExtraY = otherOuterY - thisInnerY - thisPt.labelExtraY;

                if(newExtraY * yDiffSign > 0) thisPt.labelExtraY += newExtraY;

            } else if((thisOuterY + thisPt.labelExtraY - thisSliceOuterY) * yDiffSign > 0) {
                // farther from the equator - happens after we've done all the
                // vertical moving we're going to do
                // move horizontally to get away from these more polar slices

                // if we're moving horz. based on a slice that's several slices away from this one
                // then we need some extra space for the lines to labels between them
                xBuffer = 3 * xDiffSign * Math.abs(i - wholeSide.indexOf(thisPt));

                otherOuterX = otherPt.cxFinal + farthestX(otherPt.px0[0], otherPt.px1[0]);
                newExtraX = otherOuterX + xBuffer - (thisPt.cxFinal + thisPt.pxmid[0]) - thisPt.labelExtraX;

                if(newExtraX * xDiffSign > 0) thisPt.labelExtraX += newExtraX;
            }
        }
    }

    for(yHalf = 0; yHalf < 2; yHalf++) {
        equatorFirst = yHalf ? topFirst : bottomFirst;
        farthestY = yHalf ? Math.max : Math.min;
        yDiffSign = yHalf ? 1 : -1;

        for(xHalf = 0; xHalf < 2; xHalf++) {
            farthestX = xHalf ? Math.max : Math.min;
            xDiffSign = xHalf ? 1 : -1;

            // first sort the array
            // note this is a copy of cd, so cd itself doesn't get sorted
            // but we can still modify points in place.
            thisQuad = quadrants[yHalf][xHalf];
            thisQuad.sort(equatorFirst);

            oppositeQuad = quadrants[1 - yHalf][xHalf];
            wholeSide = oppositeQuad.concat(thisQuad);

            thisQuadOutside = [];
            for(i = 0; i < thisQuad.length; i++) {
                if(thisQuad[i].yLabelMid !== undefined) thisQuadOutside.push(thisQuad[i]);
            }

            firstOppositeOutsidePt = false;
            for(i = 0; yHalf && i < oppositeQuad.length; i++) {
                if(oppositeQuad[i].yLabelMid !== undefined) {
                    firstOppositeOutsidePt = oppositeQuad[i];
                    break;
                }
            }

            // each needs to avoid the previous
            for(i = 0; i < thisQuadOutside.length; i++) {
                var prevPt = i && thisQuadOutside[i - 1];
                // bottom half needs to avoid the first label of the top half
                // top half we still need to call scootOneLabel on the first slice
                // so we can avoid other slices, but we don't pass a prevPt
                if(firstOppositeOutsidePt && !i) prevPt = firstOppositeOutsidePt;
                scootOneLabel(thisQuadOutside[i], prevPt);
            }
        }
    }
}
