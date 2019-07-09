 /*!
 * @license
 * Copyright 2019 Alfresco, Inc. and/or its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Injectable } from '@angular/core';
import { stringToXml, processXmlSchemaNode, getTextBeforePointer } from '../../schemas/processXml.schema';

 @Injectable()
 export class XmlCompletionService {


    getXmlCompletionProvider(monaco) {
        return {
            triggerCharacters: ['<'],
            provideCompletionItems (model, position) {
                // get editor content before the pointer
                const textUntilPosition = getTextBeforePointer(model, position);
                // get content info - are we inside of the area where we don't want suggestions,
                // what is the content without those areas
                const info = getAreaInfo(textUntilPosition); // isCompletionAvailable, clearedText
                // if we don't want any suggestions, return empty array
                if (!info.isCompletionAvailable) {
                    return [];
                }
                // if we want suggestions, inside of which tag are we?
                const lastTag = getLastOpenedTag(info.clearedText);
                // parse the content (not cleared text) into an xml document
                let xmlDoc = stringToXml(textUntilPosition);
                // get opened tags to see what tag we should look for in the XSD schema
                const openedTags = [];
                const usedItems = [];
                // no need to calculate the position in the XSD schema if we are in the root element
                if (lastTag) {
                    // parse the content (not cleared text) into an xml document
                    xmlDoc = stringToXml(textUntilPosition);
                    let lastChild = xmlDoc.lastElementChild;
                    while (lastChild) {
                        openedTags.push(lastChild.tagName);
                        // if we found our last opened tag
                        if (lastChild.tagName === lastTag.tagName) {
                        // if we are looking for attributes, then used items should
                        // be the attributes we already used
                        if (lastTag.isAttributeSearch) {
                            const attrs = lastChild.attributes;
                            for (let i = 0; i < attrs.length; i++) {
                                usedItems.push(attrs[i].nodeName);
                            }
                        } else {
                            // if we are looking for child elements, then used items
                            // should be the elements that were already used
                            const children = lastChild.children;
                            for (let i = 0; i < children.length; i++) {
                            usedItems.push(children[i].tagName);
                            }
                        }
                        break;
                        }
                        // we haven't found the last opened tag yet, so we move to
                        // the next element
                        lastChild = lastChild.lastElementChild;
                    }
                }
                let currentItem = processXmlSchemaNode;
                for (let i = 0; i < openedTags.length; i++) {
                    if (currentItem) {
                        currentItem = findElements(currentItem.children, openedTags[i]);
                    }
                }

                if (lastTag.isAttributeSearch) {
                    // get attributes completions
                    return currentItem ? getAvailableAttribute(monaco, currentItem.children, usedItems) : [];
                  } else {
                    // get elements completions
                    return currentItem ? getAvailableElements(monaco, currentItem.children, usedItems) : [];
                  }
            }
        };
    }
 }

 export function getAreaInfo(text) {
    // opening for strings, comments and CDATA
    const items = ['"', '\'', '<!--', '<![CDATA['];
    let isCompletionAvailable = true;
    // remove all comments, strings and CDATA
    text = text.replace(/"([^"\\]*(\\.[^"\\]*)*)"|\'([^\'\\]*(\\.[^\'\\]*)*)\'|<!--([\s\S])*?-->|<!\[CDATA\[(.*?)\]\]>/g, '');
    for (let i = 0; i < items.length; i++) {
        const itemIdx = text.indexOf(items[i]);
        if (itemIdx > -1) {
            // we are inside one of unavailable areas, so we remove that area
            // from our clear text
            text = text.substring(0, itemIdx);
            // and the completion is not available
            isCompletionAvailable = false;
        }
    }
    return {
        isCompletionAvailable: isCompletionAvailable,
        clearedText: text
    };
  }

  export function getLastOpenedTag(text) {
    // get all tags inside of the content
    const tags = text.match(/<\/*(?=\S*)([a-zA-Z-]+)/g);
    if (!tags) {
        return undefined;
    }
    // we need to know which tags are closed
    const closingTags = [];
    for (let i = tags.length - 1; i >= 0; i--) {
        if (tags[i].indexOf('</') === 0) {
            closingTags.push(tags[i].substring('</'.length));
        } else {
            // get the last position of the tag
            const tagPosition = text.lastIndexOf(tags[i]);
            const tag = tags[i].substring('<'.length);
            const closingBracketIdx = text.indexOf('/>', tagPosition);
            // if the tag wasn't closed
            if (closingBracketIdx === -1) {
                // if there are no closing tags or the current tag wasn't closed
                if (!closingTags.length || closingTags[closingTags.length - 1] !== tag) {
                    // we found our tag, but let's get the information if we are looking for
                    // a child element or an attribute
                    text = text.substring(tagPosition);
                    return {
                        tagName: tag,
                        isAttributeSearch: text.indexOf('<') > text.indexOf('>')
                    };
                }
                // remove the last closed tag
                closingTags.splice(closingTags.length - 1, 1);
            }
            // remove the last checked tag and continue processing the rest of the content
            text = text.substring(0, tagPosition);
        }
    }
  }

  export function findElements(elements, elementName?) {
    for (let i = 0; i < elements.length; i++) {
        // we are looking for elements, so we don't need to process annotations and attributes
        if (elements[i].tagName !== 'annotation' && elements[i].tagName !== 'attribute') {
            // if it is one of the nodes that do not have the info we need, skip it
            // and process that node's child items
            if (shouldSkipLevel(elements[i].tagName)) {
                const child = this.findElements(elements[i].children, elementName);
                // if child exists, return it
                if (child) {
                    return child;
                }
            } else if (!elementName) {
                return elements;
            } else if (getElementAttributes(elements[i]).name === elementName) {
                return elements[i];
            }
        }
    }
  }

  export function shouldSkipLevel(tagName) {
    // if we look at the XSD schema, these nodes are containers for elements,
    // so we can skip that level
    return tagName === 'complexType' || tagName === 'all' || tagName === 'sequence';
  }

  export function getElementAttributes(element): any {
    const attrs = {};
    for (let i = 0; i < element.attributes.length; i++) {
        attrs[element.attributes[i].name] = element.attributes[i].value;
    }
    // return all attributes as an object
    return attrs;
  }

  export function getAvailableAttribute(monaco, elements, usedChildTags) {
    const availableItems = [];
    let children;
    for (let i = 0; i < elements.length; i++) {
        // annotation element only contains documentation,
        // so no need to process it here
        if (elements[i].tagName !== 'annotation') {
            // get all child elements that have 'attribute' tag
            children = findAttributes([elements[i]]);
        }
    }
    // if there are no attributes, then there are no
    // suggestions available
    if (!children) {
        return [];
    }
    for (let i = 0; i < children.length; i++) {
        // get all attributes for the element
        const attrs: any = getElementAttributes(children[i]);
        // accept it in a suggestion list only if it is available
        if (isItemAvailable(attrs.name, attrs.maxOccurs, usedChildTags)) {
            // mark it as a 'property', and get the documentation
            availableItems.push({
                label: attrs.name,
                kind: monaco.languages.CompletionItemKind.Property,
                detail: attrs.type,
                documentation: getItemDocumentation(children[i])
            });
        }
    }
    // return the elements we found
    return availableItems;
  }

  export function findAttributes(elements) {
    const attrs = [];
    for (let i = 0; i < elements.length; i++) {
        // skip level if it is a 'complexType' tag
        if (elements[i].tagName === 'complexType') {
            const child = findAttributes(elements[i].children);
            if (child) {
                return child;
            }
        } else if (elements[i].tagName === 'attribute') {
            attrs.push(elements[i]);
        }
    }
    return attrs;
  }

  export function isItemAvailable(itemName, maxOccurs, items) {
    // the default for 'maxOccurs' is 1
    maxOccurs = maxOccurs || '1';
    // the element can appear infinite times, so it is available
    if (maxOccurs && maxOccurs === 'unbounded') {
        return true;
    }
    // count how many times the element appeared
    let count = 0;
    for (let i = 0; i < items.length; i++) {
        if (items[i] === itemName) {
            count++;
        }
    }
    return (count === 0 || parseInt(maxOccurs, 10)) > count;
  }

  export function getItemDocumentation(element) {
    for (let i = 0; i < element.children.length; i++) {
        if (element.children[i].tagName === 'annotation') {
            return getItemDocumentation(element.children[0]);
        } else if (element.children[i].tagName === 'documentation') {
            return element.children[i].textContent;
        }
    }
  }

  export function getAvailableElements(monaco, elements, usedItems) {
    const availableItems = [];
    let children;
    for (let i = 0; i < elements.length; i++) {
        // annotation element only contains documentation,
        // so no need to process it here
        if (elements[i].tagName !== 'annotation') {
            // get all child elements that have 'element' tag
            children = findElements([elements[i]]);
        }
    }
    // if there are no such elements, then there are no suggestions
    if (!children) {
        return [];
    }
    for (let i = 0; i < children.length; i++) {
        // get all element attributes
        const elementAttrs = getElementAttributes(children[i]);
        // the element is a suggestion if it's available
        if (isItemAvailable(elementAttrs.name, elementAttrs.maxOccurs, usedItems)) {
            // mark it as a 'field', and get the documentation
            availableItems.push({
                label: elementAttrs.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: elementAttrs.type,
                documentation: getItemDocumentation(children[i])
            });
        }
    }
    // return the suggestions we found
    return availableItems;
  }
