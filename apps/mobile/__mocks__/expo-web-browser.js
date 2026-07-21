const openBrowserAsync = jest.fn(async () => ({ type: "opened" }));

module.exports = {
  openBrowserAsync,
  WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" },
};
