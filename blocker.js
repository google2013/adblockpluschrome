// ABP content type flags - ignored for now
var TypeMap = {
  OTHER: 1, SCRIPT: 2, IMAGE: 4, STYLESHEET: 8, OBJECT: 16,
  SUBDOCUMENT: 32, DOCUMENT: 64, BACKGROUND: 256, XBL: 512,
  PING: 1024, XMLHTTPREQUEST: 2048, OBJECT_SUBREQUEST: 4096,
  DTD: 8192, MEDIA: 16384, FONT: 32768, ELEMHIDE: 0xFFFD
};

var enabled = false;
var experimentalEnabled = false;
var serial = 0; // ID number for elements, indexes elementCache
var elementCache = new Array(); // Keeps track of elements that we may want to get rid of
var elementCacheOrigDisplay = {};
var elemhideSelectors = null; // Cache the selectors
// var date = new Date();
// var lastInsertedNodeTime = 0;
var handleNodeInsertedTimeoutID = 0;

// Open a port to the extension
var port = chrome.extension.connect({name: "filter-query"});

function nukeSingleElement(elt) {
    //console.log("nukeSingleElement " + document.domain );
    if(elt.innerHTML) elt.innerHTML = "";
    if(elt.innerText) elt.innerText = "";
    // Probably vain attempt to stop scripts
    if(elt.src) elt.src = "";
    if(elt.language) elt.language = "Blocked!";
    elt.style.width = elt.style.height = "0px !important";
    elt.style.visibility = "hidden !important";

	var pn = elt.parentNode;
	//if(pn) pn.removeChild(elt);

	// Get rid of OBJECT tag enclosing EMBED tag
	if(pn && pn.tagName == "EMBED" && pn.parentNode && pn.parentNode.tagName == "OBJECT")
		pn.parentNode.removeChild(pn);    
}

// Set up message handlers. These remove undesirable elements from the page.
port.onMessage.addListener(function(msg) {
    if(msg.shouldBlockList) {
        if(enabled == true) {
            var ptr = 0;
            for(var i = 0; i < elementCache.length; i++) {
                if(i == msg.shouldBlockList[ptr]) {
                    // It's an ad, nuke it
                    nukeSingleElement(elementCache[i]);
                    ptr++;
                }
            }
        }
        // Take away our injected CSS, leaving only ads hidden
        if(experimentalEnabled) {
            document.documentElement.removeChild(styleElm);
            styleElm = null;
        }
        
    } else if(false && msg.shouldBlockList) {
        // Old code from when we weren't hiding everything and revealing non-ads
        // console.log("Nuking a list of things! " + msg.shouldBlockList.length);
        for(var i = 0; i < msg.shouldBlockList.length; i++) {
            var elt = elementCache[msg.shouldBlockList[i]];
            // if(elt.tagName == "IMG")
            //     console.log(msg.shouldBlockList[i] + "!!! " + elt.tagName + ":" + elt.src + " #" + elt.id + " ." + elt.className);
            nukeSingleElement(elt);
        }
        delete msg.shouldBlockList;
    }
});

chrome.extension.onRequest.addListener(function(request, sender, sendResponse) {
    // background.html might want to know this document's domain
    if(request.reqtype == "get-domain") {
        sendResponse({domain: document.domain});
    } else if(request.reqtype == "clickhide-active?") {
        // Return any rules we might have constructed
        sendResponse({isActive: clickHide_activated, filters: clickHideFilters});
    } else if(request.reqtype == "clickhide-activate") {
        clickHide_activate();
    } else if(request.reqtype == "clickhide-deactivate") {
        clickHide_deactivate();
    } else if(request.reqtype == "remove-ads-again") {
        removeAdsAgain();
    } else
        sendResponse({});
});

var clickHide_activated = false;
var currentElement = null;
var currentElement_border = "";
var currentElement_backgroundColor;
var clickHideFilters = null;
var highlightedElementsSelector = null;
var highlightedElementsBorders = null;
var highlightedElementsBGColors = null;

function highlightElements(selectorString) {
    if(highlightedElementsSelector)
        unhighlightElements();
    
    highlightedElements = document.querySelectorAll(selectorString);
    highlightedElementsSelector = selectorString;
    
    highlightedElementsBorders = new Array();
    highlightedElementsBGColors = new Array();
    for(var i = 0; i < highlightedElements.length; i++) {
        highlightedElementsBorders[i] = highlightedElements[i].style.border;
        highlightedElementsBGColors[i] = highlightedElements[i].style.backgroundColor;
        highlightedElements[i].style.border = "1px solid #fd6738";
        highlightedElements[i].style.backgroundColor = "#f6e1e5";
    }
}

function unhighlightElements() {
    if(highlightedElementsSelector == null)
        return;
    highlightedElements = document.querySelectorAll(highlightedElementsSelector);
    for(var i = 0; i < highlightedElements.length; i++) {
        highlightedElements[i].style.border = highlightedElementsBorders[i];
        highlightedElements[i].style.backgroundColor = highlightedElementsBGColors[i];
    }
    highlightedElementsSelector = null;
}

// Turn on the choose element to create filter thing
function clickHide_activate() {
    if(currentElement) {
        currentElement.style.border = currentElement_border;
        currentElement.style.backgroundColor = currentElement_backgroundColor;
        currentElement = null;
        clickHideFilters = null;
    }
    clickHide_activated = true;
    document.addEventListener("mouseover", clickHide_mouseOver, false);
    document.addEventListener("mouseout", clickHide_mouseOut, false);
    document.addEventListener("click", clickHide_mouseClick, false);
    document.addEventListener("keyup", clickHide_keyUp, false);
}

// Called when user has clicked on something and we are waiting for confirmation
// on whether the user actually wants these filters
function clickHide_rulesPending() {
    clickHide_activated = false;
    document.removeEventListener("mouseover", clickHide_mouseOver, false);
    document.removeEventListener("mouseout", clickHide_mouseOut, false);
    document.removeEventListener("click", clickHide_mouseClick, false);
    document.removeEventListener("keyup", clickHide_keyUp, false);
}

function clickHide_deactivate() {
    if(currentElement) {
        unhighlightElements();
        currentElement.style.border = currentElement_border;
        currentElement.style.backgroundColor = currentElement_backgroundColor;
        currentElement = null;
        clickHideFilters = null;
    }
    clickHide_activated = false;
    document.removeEventListener("mouseover", clickHide_mouseOver, false);
    document.removeEventListener("mouseout", clickHide_mouseOut, false);
    document.removeEventListener("click", clickHide_mouseClick, false);
    document.removeEventListener("keyup", clickHide_keyUp, false);
}

function clickHide_mouseOver(e) {
    if(clickHide_activated == false)
        return;
    
    if((e.target.id && e.target.id != "") || (e.target.className && e.target.className != "")) {
        currentElement = e.target;
        currentElement_border = e.target.style.border;
        currentElement_backgroundColor = e.target.style.backgroundColor;
        e.target.style.border = "1px solid #d6d84b";
        e.target.style.backgroundColor = "#f8fa47";
    }
}

function clickHide_mouseOut(e) {
    if(clickHide_activated == false || currentElement == null)
        return;
    
    currentElement.style.border = currentElement_border;
    currentElement.style.backgroundColor = currentElement_backgroundColor;
}

function clickHide_keyUp(e) {
    if(e.ctrlKey && e.shiftKey && e.keyCode == 69)
        clickHide_mouseClick(e);
}

// When the user clicks, the currentElement is the one we want.
// We should have ABP rules ready for when the
// popup asks for them.
function clickHide_mouseClick(e) {
    if(clickHide_activated == false)
        return;
        
    // Eat the click event - could be a stray click
    e.preventDefault();
    e.stopPropagation();
    // If we don't have an element, let the user keep trying
    if(currentElement == null)
        return;

    // Construct ABP filter(s). The popup will retrieve these.
    // Only one ID
    var elementId = currentElement.id ? currentElement.id.split(' ').join('') : null;
    // Can have multiple classes...
    var elementClasses = currentElement.className ? currentElement.className.split(' ') : null;
    clickHideFilters = new Array();
    selectorList = new Array();
    if(elementId && elementId != "") {
        clickHideFilters.push(document.domain + "###" + elementId);
        selectorList.push("#" + elementId);
    }
    if(elementClasses && elementClasses.length > 0) {
        for(var i = 0; i < elementClasses.length; i++) {
            clickHideFilters.push(document.domain + "##." + elementClasses[i]);
            selectorList.push("." + elementClasses[i]);
        }
    }
    
    // Save the filters that the user created
	chrome.extension.sendRequest({reqtype: "cache-filters", filters: clickHideFilters});

    // Highlight the unlucky elements
    // Restore currentElement's border and bgcolor so that highlightElements won't save those
    currentElement.style.border = currentElement_border;
    currentElement.style.backgroundColor = currentElement_backgroundColor;
    highlightElements(selectorList.join(","));
    currentElement.style.border = "1px solid #fd1708";
    currentElement.style.backgroundColor = "#f6a1b5";

    // Half-deactivate click-hide so the user has a chance to click the page action icon.
    // currentElement is still set to the putative element to be blocked.
    clickHide_rulesPending();
}

// Called when a new filter is added.
// It would be a click-to-hide filter, so it's only an elemhide filter.
// Since this rarely happens, we can afford to do a full run of ad removal.
function removeAdsAgain() {
    chrome.extension.sendRequest({reqtype: "get-domain-enabled-state"}, function(response) {
        if(response.enabled) {
            elemhideSelectors = null; // Dirty
            hideElements(document);
            nukeElements(document);
        }
    });
}

// Block ads in nodes inserted by scripts
function handleNodeInserted(e) {
    // Can't run hideElements every time a node is inserted - big CPU/heap impact
    // TODO: cache selectors, marking them dirty in removeAdsAgain().
    // Set nukeElements to fire at most once a second
    if(enabled && handleNodeInsertedTimeoutID == 0) {
        handleNodeInsertedTimeoutID = setTimeout(nukeAndHideElements, 1000);
    }
}

function hideBySelectors(selectors, parent) {
    var elts = $(selectors.join(","), parent);
    if(enabled) {
        for(var i = 0; i < elts.length; i++) {
            elts[i].style.visibility = "hidden";
            elts[i].style.display = "none";
        }
    }
}

function nukeAndHideElements(parent) {
    hideElements(parent);
    nukeElements(parent);
}

function hideElements(parent) {
    if(elemhideSelectors == null) {
        chrome.extension.sendRequest({reqtype: "get-elemhide-selectors", domain: document.domain}, function(response) {
            elemhideSelectors = response.selectors;
            hideBySelectors(elemhideSelectors, parent);
        });
    } else {
        hideBySelectors(elemhideSelectors, parent);
    }
}

function nukeElements(parent) {
    elts = $("img,object,iframe,embed", parent);
    // console.log("nukeElements " + elts.length);
	types = new Array();
	urls = new Array();
	serials = new Array();
	for(i = 0; i < elts.length; i++) {
		elementCache.push(elts[i]);
		var url;
		// Check children of object nodes for "param" nodes with name="movie" that specify a URL
		// in value attribute
		if(elts[i].tagName == "OBJECT" && !(url = elts[i].getAttribute("data"))) {
		    // No data attribute, look in PARAM child tags
		    var params = $("param[name=\"movie\"]", elts[i]);
		    // This OBJECT could contain an EMBED we already nuked, in which case there's no URL
		    if(params[0]) url = params[0].getAttribute("value");
	    } else {
	        url = elts[i].getAttribute("src");
        }

		if(url) {
		    // TODO: Some rules don't include the domain, and the blacklist
		    // matcher doesn't match on queries that don't include the domain
		    if(!url.match(/^http/)) url = "http://" + document.domain + url;
    		types.push(4); // TypeMap constants are ignored for now
    		urls.push(url);
    		serials.push(serial);
	    }
		serial++;
	}
	// Ask background.html which of these elements we should nuke
	port.postMessage({reqtype: "should-block-list?", urls: urls, types: types, serials: serials, domain: document.domain});
	// Special case many Google and BBC ads.
	// TODO: move this into a user-editable list
    if(enabled) $("object[width=\"728\" height=\"90\"],[id^=google_ads_div],[id^=ad_],[id^=AD_]").remove();
	
	handleNodeInsertedTimeoutID = 0;
}

chrome.extension.sendRequest({reqtype: "get-experimental-enabled-state"}, function(response2) {
    experimentalEnabled = response2.experimentalEnabled;
    chrome.extension.sendRequest({reqtype: "get-domain-enabled-state"}, function(response) {
        enabled = response.enabled;
        if(enabled) {
            // Hide ads by selector using CSS
            hideElements(document);
            // Nuke ads by src
            nukeElements(document);
            document.addEventListener("DOMNodeInserted", handleNodeInserted, false);
        } else if (experimentalEnabled && styleElm) {
            // Disabled, so take away initially injected stylesheet
            document.documentElement.removeChild(styleElm);
            styleElm = null;
        }
    });
});