# NODE-SETTINGS

Settings is a lightweight JSON configuration file loader

## Installation

To install use npm:

```bash
npm i @mahelbir/settings
```

## Usage

```javascript
import {setDefaultFile, initSettings, Settings} from "@mahelbir/settings";
import settings from "@mahelbir/settings";

/* New Instance */
{
    const settings = new Settings("./configs/settings.json");

    console.log("example->a->b", settings.get("example.a.b")); // Deep get
    settings.set("secondKey", ["test"]);
    console.log("secondKey", settings.get("secondKey[0]"));
    settings.set("thirdKey", ["test"]);
    settings.unset("thirdKey", ["test"]);
    console.log("thirdKey", settings.get("thirdKey"));

    // This will return the current object
    console.log(settings.memory());

    // if you don't call save, the file will not be updated but the object will be updated
    settings.save();
}

/* Continuously updated instance */
{
    // Set the default file for the settings
    setDefaultFile("./configs/new.json");

    initSettings(3); // This will get the current settings from the default file every 3 seconds
    // You have to call settings() to get the current settings

    console.log(settings().all()); // This will return whole settings

    // Even if external factors change the file, the settings are still up-to-date with the changed file
    let isChanged = false;
    let firstValue = settings().get("data.time");
    setInterval(() => {
        const currentValue = settings().get("data.time");
        if (firstValue !== currentValue) {
            isChanged = true;
        }
        console.log("isChanged", isChanged);
    }, 1000);
}

/* Example of external change */
setTimeout(() => {
    Settings.put({"data.time": Date.now()}); // "isChanged" will be true after 5 seconds
}, 5000);
```

## License

The MIT License (MIT). Please see [License File](LICENSE) for more information.