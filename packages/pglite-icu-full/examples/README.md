# Generating an ICU package for PGlite

This document shows you how to generate your own icu file that contains only the locales that you want in your PGlite enabled application.

## Download libicu code and data

Currently PGlite is tested to work with libicu v76.1. Get the source and data for it:

```bash
$ wget https://github.com/unicode-org/icu/releases/download/release-76-1/icu4c-76_1-src.tgz

$ wget https://github.com/unicode-org/icu/releases/download/release-78.3/icu4c-78.3-data.zip
```

Important: You must have the data sources in order to use the ICU Data Build Tool. Check for the file icu4c/source/data/locales/root.txt. If that file is missing, you need to download “icu4c-*-data.zip”, delete the old icu4c/source/data directory, and replace it with the data directory from the zip file. If there is a *.dat file in icu4c/source/data/in, that file will be used even if you gave ICU custom filter rules.

## Create a filters.json file

This will allow you to only generate the data that you need.

Here's a simple example:
```
{
  "localeFilter": {
    "filterType": "locale",
    "includelist": [
      "en_US"
    ]
  }
}
```

For more info, see https://unicode-org.github.io/icu/userguide/icu_data/buildtool.html.

## Build ICU

```typescript
$ ICU_DATA_FILTER_FILE=<full_path_to_your_filters.json> ./icu/source/configure --with-data-packaging=files --disable-shared --enable-static --disable-tests --disable-samples --disable-extras --disable-icuio --disable-layoutex --prefix=<your_install_dir>

$ make -j && make install
```

## Create an archive with the icu data

The previous steps have installed everything related to ICU in <your_install_dir>. You only need the data files:

```
$ cd <your_install_dir>/share/icu/76.1/ && tar cvfz icu_76.tgz icudt76l/
```

Now `icu_76.tgz` contains the localisation data that you can use with PGlite.

## Example

The subfolder `Switzerland` contains the `filter.json` and the generated data file that can be used with PGlite.