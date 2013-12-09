
var app = angular.module("pulseExample", ['ng', 'pulse']);

app.config(
    function (pulseProvider) {

        pulseProvider.setPlaylistGenerator(
            'pulseExamplePlaylistGenerator'
        );

        pulseProvider.addClipType(
            'weather',
            {
                controller: 'pulseWeatherExampleController',
                templateUrl: 'partials/weatherExample.html',
                resolve: {
                    forecast: function ($http, pulseClipParams) {
                        var location = pulseClipParams.location || 'San Francisco, CA';
                        var locationStr = encodeURIComponent(location);
                        return $http.jsonp(
                            'http://api.openweathermap.org/data/2.5/weather?q=' + locationStr + '&callback=JSON_CALLBACK'
                        ).then(
                            function (response) {
                                return response.data;
                            }
                        );
                        return 'sunny';
                    }
                }
            }
        );

    }
);

app.factory(
    'pulseExamplePlaylistGenerator',
    function ($q) {
        return function () {
            var defer = $q.defer();
            defer.resolve(
                [
                    {
                        type: 'weather',
                        params: {
                            location: 'London, UK'
                        }
                    }
                ]
            );
            return defer.promise;
        };
    }
);

app.controller(
    'pulseWeatherExampleController',
    function ($scope, forecast) {
        $scope.forecast = forecast;
    }
);
