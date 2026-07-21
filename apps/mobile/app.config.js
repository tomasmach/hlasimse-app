const path = require("node:path");

const PRODUCTION_PROFILE = "production";

module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim();
  const isProductionBuild = process.env.EAS_BUILD_PROFILE === PRODUCTION_PROFILE;

  if (isProductionBuild && !googleServicesFile) {
    throw new Error(
      "Production EAS builds require the GOOGLE_SERVICES_JSON file variable for Android push configuration.",
    );
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile
        ? { googleServicesFile: path.resolve(googleServicesFile) }
        : {}),
    },
  };
};
