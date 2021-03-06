
(function (angular) {

     var pulse = angular.module('pulse', ['ng']);

     pulse.provider(
         'pulse',
         function () {
             var pulseProvider = {};

             var playlistGenerator;
             var clipLoadTimeout = 5000;
             var clipQueue = [];
             var nextClipIndex = 0;
             var clipRootTemplate = '<html style="overflow:hidden;border:0;"><head></head><body pulse-clip></body></html>';
             var clipRootTemplateUrl;
             var clipRootTemplatePromise;
             var clipTypeDefs = {};
             var currentClip;
             var nextClip;

             pulseProvider.addClipType = function (name, def) {
                 // TODO: validate/normalize this thing
                 clipTypeDefs[name] = def;
             };

             pulseProvider.setPlaylistGenerator = function (generator) {
                 playlistGenerator = generator;
                 return self;
             };

             pulseProvider.setClipLoadTimeout = function (timeout) {
                 clipLoadTimeout = timeout;
                 return self;
             };

             pulseProvider.setClipRootTemplate = function (template) {
                 clipRootTemplate = template;
                 clipRootTemplateUrl = undefined;
             };

             pulseProvider.setClipRootTemplateUrl = function (templateUrl) {
                 clipRootTemplateUrl = templateUrl;
                 clipRootTemplate = undefined;
             };

             pulseProvider.$get = function ($q, $http, $timeout, $injector, $templateCache, $rootScope) {
                 var pulse = {};

                 playlistGenerator = playlistGenerator || function () {
                     var defer = $q.defer();
                     defer.reject();
                     return defer.promise;
                 };

                 function inherit(parent, extra) {
                     return angular.extend(new (angular.extend(function() {}, {prototype:parent}))(), extra);
                 }

                 if (angular.isDefined(clipRootTemplate)) {
                     var clipRootTemplateDefer = $q.defer();
                     clipRootTemplateDefer.resolve(clipRootTemplate);
                     clipRootTemplatePromise = clipRootTemplateDefer.promise;
                 }
                 else {
                     clipRootTemplatePromise = $http.get(clipRootTemplateUrl).then(
                         function (response) {
                             return response.data;
                         }
                     );
                 }

                 function getNextClip() {
                     var defer = $q.defer();

                     if (nextClipIndex >= clipQueue.length) {
                         // We've depleted the queue, so let's try to generate some more.
                         var tryUpdatePlaylist;
                         tryUpdatePlaylist = function () {
                             if (angular.isString(playlistGenerator)) {
                                 playlistGenerator = $injector.get(playlistGenerator);
                             }
                             playlistGenerator().then(
                                 function (clipDefs) {
                                     if (clipDefs.length < 1) {
                                         // nothing to play right now? try again in a bit
                                         $timeout(tryUpdatePlaylist, 3000);
                                     }
                                     else {
                                         clipQueue = clipDefs;
                                         nextClipIndex = 1;
                                         defer.resolve(clipQueue[0]);
                                     }
                                 },
                                 function () {
                                     // playlist generation failed, so wait and try again in a bit.
                                     $timeout(tryUpdatePlaylist, 3000);
                                 }
                             );
                         };
                         tryUpdatePlaylist();
                     }
                     else {
                         var selectedClipDef = clipQueue[nextClipIndex++];
                         defer.resolve(selectedClipDef);
                     }

                     return defer.promise;
                 }

                 function prepareNextClip() {
                     var defer = $q.defer();

                     getNextClip().then(
                         function (clipDef) {
                             var clipType = clipTypeDefs[clipDef.type];
                             if (! clipType) {
                                 throw new Error('Playlist called for unknown clip type ' + clipDef.type);
                             }
                             var params = clipDef.params || {};
                             var resolve = clipType.resolve || {};
                             var resolveLocals = {
                                 pulseClipParams: params
                             };
                             var locals = angular.extend({}, resolveLocals);
                             for (var k in resolve) {
                                 var value = resolve[k];
                                 locals[k] = (
                                     angular.isString(value) ?
                                         $injector.get(value) :
                                         $injector.invoke(value, undefined, resolveLocals)
                                 );
                             }
                             if (angular.isDefined(clipType.template)) {
                                 locals.$template = clipType.template;
                             }
                             else if (angular.isDefined(clipType.templateUrl)) {
                                 locals.$template = $http.get(
                                     clipType.templateUrl,
                                     {cache: $templateCache}
                                 ).then(
                                     function(response) {
                                         return response.data;
                                     }
                                 );
                             }

                             $q.all(locals).then(
                                 function (locals) {
                                     defer.resolve(
                                         inherit(
                                             clipType,
                                             {
                                                 template: locals.$template,
                                                 params: clipDef.params,
                                                 locals: locals
                                             }
                                         )
                                     );
                                 },
                                 function (error) {
                                     defer.reject(error);
                                 }
                             );
                         }
                     );

                     return defer.promise;
                 }

                 // next clip resolved
                 // next clip ready to start
                 // current clip ready to end
                 // transition start
                 // transition end

                 var preResolvedDefer = $q.defer();
                 preResolvedDefer.resolve();
                 var lifecycleDefers = {
                     nextClipResolved: preResolvedDefer,
                     nextClipReadyToStart: preResolvedDefer,
                     currentClipReadyToEnd: preResolvedDefer,
                     clipTransitionStart: preResolvedDefer,
                     clipTransitionEnd: preResolvedDefer
                 };

                 $rootScope.$on(
                     'pulseClipReadyToEnd',
                     function (evt, clip) {
                         lifecycleDefers.currentClipReadyToEnd.resolve(clip);
                     }
                 );

                 $rootScope.$on(
                     'pulseClipReadyToStart',
                     function (evt) {
                         lifecycleDefers.nextClipReadyToStart.resolve();
                     }
                 );

                 $rootScope.$on(
                     'pulseClipTransitionStarting',
                     function (evt, newClip, oldClip) {
                         lifecycleDefers.clipTransitionStart.resolve();
                     }
                 );

                 $rootScope.$on(
                     'pulseClipTransitionEnding',
                     function (evt, newClip, oldClip) {
                         lifecycleDefers.clipTransitionEnd.resolve();
                     }
                 );

                 var runClipLifecycle;
                 runClipLifecycle = function () {
                     lifecycleDefers.nextClipResolved = $q.defer();
                     lifecycleDefers.nextClipReadyToStart = $q.defer();
                     lifecycleDefers.clipTransitionStart = $q.defer();
                     lifecycleDefers.clipTransitionEnd = $q.defer();

                     lifecycleDefers.nextClipResolved.promise.then(
                         function (clip) {
                             nextClip = clip;
                             $rootScope.$broadcast(
                                 'pulseClipPrepared',
                                 clip
                             );
                             lifecycleDefers.nextClipReadyToStart.promise.then(
                                 function () {
                                     lifecycleDefers.currentClipReadyToEnd.promise.then(
                                         function (oldClip) {
                                             $rootScope.$broadcast(
                                                 'pulseStartClipTransition'
                                             );
                                             lifecycleDefers.clipTransitionStart.promise.then(
                                                 function () {
                                                     lifecycleDefers.currentClipReadyToEnd = $q.defer();
                                                     currentClip = clip;
                                                     nextClip = undefined;
                                                     lifecycleDefers.clipTransitionEnd.promise.then(
                                                         function () {
                                                             runClipLifecycle();
                                                         }
                                                     );
                                                 }
                                             );
                                         }
                                     );
                                 }
                             );
                         }
                     );

                     prepareNextClip().then(
                         function (clip) {
                             lifecycleDefers.nextClipResolved.resolve(clip);
                         }
                     );
                 };

                 runClipLifecycle();

                 pulse.getClipRootTemplate = function () {
                     return clipRootTemplatePromise;
                 };

                 return pulse;
             };

             return pulseProvider;
         }
     );

     pulse.directive(
         'pulseClips',
         function (pulse, $compile, $controller, $animate) {
             return {
                 restrict: 'E',
                 terminal: true,
                 priority: 400,
                 link: function(scope, $element, attr, ctrl) {

                     var currentScope;
                     var currentFrame;
                     var nextScope;
                     var nextFrame;

                     function prepareNextClip(clip) {
                         // if we already prepped a clip, clean up what we did.
                         if (nextScope) {
                             nextScope.$destroy();
                             nextFrame.remove();
                             nextScope = undefined;
                             nextFrame = undefined;
                         }
                         var newScope = scope.$new();
                         var locals = clip.locals;
                         var template = clip.template;
                         clip.scope = newScope;
                         locals.$scope = newScope;
                         var controller = $controller(clip.controller, locals);
                         var newFrame = angular.element('<div></div>');
                         var shadow = angular.element(newFrame[0].webkitCreateShadowRoot());
                         // we pre-set ng-enter on this so it can benefit from
                         // any initial animation properties set in the CSS even though
                         // we're inserting this much earlier to give a chance for any
                         // necessary resource to load before we transition in.
                         newFrame.attr('class', 'pulse-clip ng-enter pulse-clip-preenter');
                         $element.append(newFrame);
                         nextScope = newScope;
                         nextFrame = newFrame;
                         shadow.html(template);
                         newScope.pulseSignals = {
                             readyToEnd: function () {
                                 scope.$emit(
                                     'pulseClipReadyToEnd',
                                     clip
                                 );
                             }
                         };

                         var link = $compile(shadow);
                         link(newScope);
                         scope.$emit(
                             'pulseClipReadyToStart'
                         );
                         var ngStyleElem = document.createElement('style');
                         ngStyleElem.innerText = '@charset "UTF-8";[ng\:cloak],[ng-cloak],[data-ng-cloak],[x-ng-cloak],.ng-cloak,.x-ng-cloak,.ng-hide{display:none !important;}ng\:form{display:block;}.ng-animate-start{border-spacing:1px 1px;-ms-zoom:1.0001;}.ng-animate-active{border-spacing:0px 0px;-ms-zoom:1;}';
                         shadow[0].appendChild(ngStyleElem);
                     }

                     scope.$on(
                         'pulseClipPrepared',
                         function (evt, clip) {
                             prepareNextClip(clip);
                         }
                     );

                     scope.$on(
                         'pulseStartClipTransition',
                         function (evt) {
                             scope.$emit(
                                 'pulseClipTransitionStarting'
                             );
                             var doneEntering = false;
                             var doneExiting = false;
                             function maybeDoneAnimating() {
                                 if (doneEntering && doneExiting) {
                                     currentFrame = nextFrame;
                                     currentScope = nextScope;
                                     nextFrame = undefined;
                                     nextScope = undefined;
                                     scope.$emit(
                                         'pulseClipTransitionEnding'
                                     );
                                     currentScope.$broadcast(
                                         'pulseClipBegin'
                                     );
                                 }
                             }

                             nextFrame.removeClass('pulse-clip-preenter');
                             $animate.enter(
                                 nextFrame,
                                 $element,
                                 currentFrame,
                                 function () {
                                     doneEntering = true;
                                     maybeDoneAnimating();
                                 }
                             );
                             if (currentFrame) {
                                 $animate.leave(
                                     currentFrame,
                                     function () {
                                         doneExiting = true;
                                         maybeDoneAnimating();
                                     }
                                 );
                             }
                             else {
                                 doneExiting = true;
                                 maybeDoneAnimating();
                             }
                         }
                     );

                 }
             };
         }
     );

})(angular);