export const metadata = { $Version: "4.01", $EntityContainer: "Demo.Container",
  $Reference: {
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": { $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }] },
    "https://aster.dev/vocabularies/Aster.Data.V1.json": { $Include: [{ $Namespace: "Aster.Data.V1", $Alias: "AsterData" }] },
  }, Demo: {
  Device: { $Kind: "EntityType", $Key: ["id"], id: { $Type: "Edm.Int32" }, name: { $Nullable: false, "@Core.Description": "Name", "@AsterData.MinLength": 1 }, platform: { "@Core.Description": "Platform" }, owner: { "@Core.Description": "Owner" } },
  Container: { $Kind: "EntityContainer", Devices: { $Collection: true, $Type: "Demo.Device" } },
} };
export const data = { Devices: Array.from({ length: 72 }, (_, i) => ({ id: i + 1, name: `Device ${String(i + 1).padStart(3, "0")}`, platform: ["macOS", "Linux", "Windows"][i % 3], owner: ["Design", "Engineering", "Operations"][i % 3] })) };
