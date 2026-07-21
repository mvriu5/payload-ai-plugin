"use client"

import AIInput from "../ai-input/AIInput.js"
import AuditLogList from "../audit-log-list/AuditLogList.js"
import styles from "./Dashboard.module.css"

const Dashboard = () => {
    return (
        <div className={styles.dashboard}>
            <AIInput homeAIInput={true}/>
            <AuditLogList />
        </div>
    )
}

export default Dashboard
