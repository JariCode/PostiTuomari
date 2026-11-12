import { saveSettings } from "../../shared/storage.js";
import { Notice, Section, Status, Toggle, useStatus } from "../ui.jsx";

export function General({ settings }) {
  const { status, run } = useStatus();
  const save = (patch, text) => run(() => saveSettings(patch), text);

  return (
    <Section id="yleiset" title="Yleiset">
      <Toggle
        label="Kuivaharjoitus"
        description="Viestejä ei siirretä. Lajittelu vain kertoo, mihin kansioon mikäkin menisi."
        checked={settings.dryRun}
        onChange={(dryRun) => save({ dryRun }, dryRun ? "Kuivaharjoitus päällä" : "Kuivaharjoitus pois päältä")}
      />
      {!settings.dryRun && (
        <Notice kind="warn">
          <strong>Kuivaharjoitus on pois päältä.</strong> Lajittelu siirtää viestejä oikeasti Saapuneiden alikansioihin.
          Liputettuja ja käsin lajiteltuja viestejä ei siirretä.
        </Notice>
      )}
      <Toggle
        label="Lajittele Thunderbirdin käynnistyessä"
        description="Käy valittujen tilien Saapuneet läpi, kun Thunderbird käynnistyy tai laajennus päivittyy."
        checked={settings.sortOnStartup}
        onChange={(sortOnStartup) => save({ sortOnStartup })}
      />
      <Toggle
        label="Lajittele uusi posti"
        description="Lajittelee viestit sitä mukaa, kun niitä saapuu valittujen tilien Saapuneisiin."
        checked={settings.sortNewMail}
        onChange={(sortNewMail) => save({ sortNewMail })}
      />
      <Toggle
        label="Yksityiskohtainen loki (vianetsintään)"
        description="Kirjoittaa lisäosan konsoliin jokaisen viestin lähettäjän, otsikon ja tuomion. Pois päältä lokiin tulee vain määriä, kategorioita ja virheitä."
        checked={settings.verboseLog}
        onChange={(verboseLog) => save({ verboseLog })}
      />
      {settings.verboseLog && (
        <Notice kind="info">Yksityiskohtainen loki on päällä: konsolissa näkyy lähettäjiä ja otsikoita. Ota pois, kun vianetsintä on valmis.</Notice>
      )}
      <Status status={status} />
    </Section>
  );
}
