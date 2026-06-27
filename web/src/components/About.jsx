import Logo from './Logo.jsx';
import { APP_VERSION, APP_COPYRIGHT, APP_LICENSE, APP_TAGLINE } from '../version.js';
import { useT } from '../i18n.jsx';

/** Acerca de: identidad, licencia, descargo de responsabilidad y aviso de marca. */
export default function About() {
  const t = useT();
  return (
    <div className="rise" style={{ maxWidth: 760, margin: '0 auto', display: 'grid', gap: 16 }}>
      <div className="card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Logo size={52} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>PBI</div>
            <div className="muted">{APP_TAGLINE} · v{APP_VERSION}</div>
          </div>
        </div>
        <p style={{ marginBottom: 4 }}>
          {t('Interfaz web libre para gestionar Proxmox Backup Server: copias de seguridad, recuperación, trabajos programados, informes, limpieza y notificaciones.')}
        </p>
        <div className="muted" style={{ fontSize: 13 }}>{APP_COPYRIGHT} · {t('Licencia')} {APP_LICENSE}</div>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{t('Licencia')}</h3>
        <p>
          {t('PBI es ')}<b>{t('software libre y de código abierto')}</b>{t(', distribuido bajo los términos de la ')}
          <b>{t('Licencia Pública General de GNU, versión 3 (GPLv3)')}</b>{t('. Puedes usarlo, estudiarlo, modificarlo y redistribuirlo conforme a dicha licencia. El texto completo se incluye en el fichero ')}
          <code>LICENSE</code>{t(' del proyecto y está disponible en ')}
          <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">gnu.org/licenses/gpl-3.0</a>.
        </p>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          {t('Este programa se entrega con ABSOLUTAMENTE NINGUNA GARANTÍA. Es software libre, y puedes redistribuirlo bajo ciertas condiciones; consulta la GPLv3 para más detalles.')}
        </p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{t('Descargo de responsabilidad')}</h3>
        <p style={{ marginBottom: 0 }}>
          {t('PBI se publica con la esperanza de que sea útil, pero ')}<b>{t('SIN NINGUNA GARANTÍA')}</b>{t(', ni siquiera la garantía implícita de comerciabilidad o idoneidad para un propósito concreto. El uso de la herramienta —en especial las operaciones de ')}
          <b>{t('restauración')}</b>{t(' y ')}<b>{t('eliminación de copias')}</b>{t('— es responsabilidad exclusiva del usuario. Verifica siempre tus copias de seguridad y realiza pruebas de restauración periódicas. Los autores no se hacen responsables de pérdidas de datos, interrupciones del servicio ni de cualquier daño derivado del uso de este software.')}
        </p>
      </div>

      <div className="card card-pad">
        <h3 style={{ marginTop: 0 }}>{t('Marcas y no afiliación')}</h3>
        <p style={{ marginBottom: 0 }}>
          {t('«Proxmox», Proxmox Backup Server y Proxmox VE son marcas de ')}<b>Proxmox Server Solutions GmbH</b>{t('. PBI es un ')}
          <b>{t('proyecto independiente y no oficial')}</b>{t(', ')}<b>{t('sin afiliación, patrocinio ni respaldo')}</b>
          {t(' de Proxmox Server Solutions GmbH. Dichos nombres se utilizan únicamente con fines descriptivos y de interoperabilidad. El logotipo de PBI es una creación original e independiente.')}
        </p>
      </div>
    </div>
  );
}
