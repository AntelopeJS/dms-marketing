const assert = require("node:assert/strict");
const { HTTPResult } = require("@antelopejs/interface-api");
const { WebsitesController } = require("../dist/routes/websites");

const test = it;

test("a website body zod refuses answers its issues in the bytes the forms read", async () => {
  await assert.rejects(
    new WebsitesController().create(
      { _id: "owner" },
      { name: 5, domain: "not a domain!!", snapshotsEnabled: "yes" },
      { rawRequest: { headers: {} } },
    ),
    (error) => {
      assert.ok(error instanceof HTTPResult);
      assert.deepEqual(
        [error.getStatus(), error.getContentType(), error.getBody()],
        [
          400,
          "application/json",
          '[{"code":"invalid_type","expected":"string","received":"number","path":["name"],"message":"Expected string, received number"},{"code":"custom","message":"$page.marketing.errors.invalid_hostname","path":["domain"]},{"code":"invalid_type","expected":"boolean","received":"string","path":["snapshotsEnabled"],"message":"Expected boolean, received string"}]',
        ],
      );
      return true;
    },
  );
});
